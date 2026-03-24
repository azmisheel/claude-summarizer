/**
 * 
 * @param {string} text 
 * @param {number} chunkSize 
 * @param {number} overlap 
 * @returns {Array<{content: string, chunkIndex: number, pageNumber: number}>}
 */
export const chunkText = (text, chunkSize = 500, overlap = 50) => {
    // If no text was passed in, return empty array — nothing to chunk
    if (!text || text.trim().length === 0) {
        return [];
    }

    // Clean up the raw text before processing:
    const cleanedText = text
        .replace(/\r\n/g, '\n')  // Windows uses \r\n for newlines, normalize to just \n
        .replace(/\s+/g, ' ')    // collapse multiple spaces into one
        .replace(/\n /g, '\n')   // remove spaces at start of lines
        .replace(/ \n/g, '\n')   // remove spaces at end of lines
        .trim();

    // Split the whole text into paragraphs (separated by blank lines)
    const paragraphs = cleanedText.split(/\n+/).filter(p => p.trim().length > 0);

    const chunks = [];        // final array of chunk objects we'll return
    let currentChunk = [];    // paragraphs being collected for the current chunk
    let currentWordCount = 0; // word count of current chunk so far
    let chunkIndex = 0;       // increments with each chunk so we can track order

    for (const paragraph of paragraphs) {
        const paragraphWords = paragraph.trim().split(/\s+/); // split paragraph into words
        const paragraphWordCount = paragraphWords.length;

        // If this single paragraph is LONGER than chunkSize words on its own,
        // save whatever we have so far and handle it separately
        if (paragraphWordCount > chunkSize) {
            // Save the current chunk before handling the big paragraph
            if (currentChunk.length > 0) {
                chunks.push({
                    content: currentChunk.join('\n\n'),
                    chunkIndex: chunkIndex++,
                    pageNumber: 0
                });
                currentChunk = [];
                currentWordCount = 0;
            }

            // Break the big paragraph into smaller pieces with overlap
            // overlap means the end of one chunk repeats at the start of the next
            // this helps Claude understand context across chunk boundaries
            for (let i = 0; i < paragraphWords.length; i += (chunkSize - overlap)) {
                const chunkWords = paragraphWords.slice(i, i + chunkSize);
                chunks.push({
                    content: chunkWords.join(' '), 
                    chunkIndex: chunkIndex++,
                    pageNumber: 0
                });
                if (i + chunkSize >= paragraphWords.length) break;
            }
            continue; // skip the rest of the loop for this paragraph
        }

        // If adding this paragraph would push us over the chunk size limit,
        // save the current chunk and start a new one with some overlap
        if (currentWordCount + paragraphWordCount > chunkSize && currentChunk.length > 0) {
            chunks.push({
                content: currentChunk.join('\n\n'),
                chunkIndex: chunkIndex++,
                pageNumber: 0
            });

            // Overlap: take the last few words from the previous chunk
            // and include them at the start of the next chunk
            // so Claude doesn't lose context at the boundary
            const prevChunkText = currentChunk.join(' ');
            const prevWords = prevChunkText.split(/\s+/);
            const overlapText = prevWords.slice(-Math.min(overlap, prevWords.length)).join(' ');
            
            currentChunk = [overlapText, paragraph.trim()]; // start new chunk with overlap + new paragraph
            currentWordCount = overlapText.split(/\s+/).length + paragraphWordCount;
        } else {
            // Paragraph fits in current chunk — just add it
            currentChunk.push(paragraph.trim());
            currentWordCount += paragraphWordCount;
        }
    }

    // After looping, save whatever is left in the current chunk
    if (currentChunk.length > 0) {
        chunks.push({
            content: currentChunk.join('\n\n'),
            chunkIndex: chunkIndex++,
            pageNumber: 0
        });
    }

    // Fallback: if somehow no chunks were created but we have text,
    // just brute force split the whole thing by word count
    if (chunks.length === 0 && cleanedText.length > 0) {
        const allWords = cleanedText.split(/\s+/);
        for (let i = 0; i < allWords.length; i += (chunkSize - overlap)) {
            const chunkWords = allWords.slice(i, i + chunkSize);
            chunks.push({
                content: chunkWords.join(' '),
                chunkIndex: chunkIndex++,
                pageNumber: 0
            });
            if (i + chunkSize >= allWords.length) break; 
        }
    }

    return chunks; // return the final array of chunk objects
}

/**
 * Finds the most relevant chunks from a document based on a search query.
 * Used to send only the most relevant parts of a PDF to Claude instead of the whole document.
 * @param {Array<Object>} chunks - Array of chunk objects from the document
 * @param {string} query - The user's question or search query
 * @param {number} maxChunks - Max number of chunks to return (default: 3)
 * @returns {Array<Object>} - Top matching chunks sorted by relevance score
 */
export const findRelaventChunks = (chunks, query, maxChunks = 3) => {
    // If no chunks exist, nothing to search through
    if(!chunks || chunks.length === 0) return [];

    // These common words don't help us find relevant chunks
    // e.g. searching "what is the capital" — "what", "is", "the" tell us nothing useful
    const stopWords = new Set(['the', 'is', 'in','at', 'which', 'or', 'but', 'and', 'to', 'of', 'a', 'that', 'it',
         'with', 'as', 'for', 'was', 'on', 'are', 'by', 'this', 'be'
    ]);
    
    // Break the query into individual words, lowercase them, remove stop words
    // and remove very short words (1-2 characters) that aren't useful for matching
    const queryWords = query
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));
    
    // If after filtering there are no meaningful words left in the query,
    // just return the first N chunks as a fallback
    if(queryWords.length === 0){
        return chunks.slice(0, maxChunks).map(chunk => ({
            content: chunk.content,
            chunkIndex: chunk.chunkIndex,
            pageNumber: chunk.pageNumber,
            _id: chunk._id
        }));
    }

    // Score every chunk based on how well it matches the query words
    const scoredChunks = chunks.map((chunk, index) => { 
        const content = chunk.content.toLowerCase();
        let contentWords = content.split(/\s+/).length; // total word count of this chunk
        let score = 0;
        
        // Loop through each meaningful query word and score this chunk
        for(const word of queryWords) {
            // Exact match: word appears as a whole word e.g. "cat" won't match "concatenate"
            // Uses \b which means "word boundary" in regex
            const exactMatches = (content.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
            score += exactMatches * 3; // exact matches are worth 3 points each

            // Partial match: word appears anywhere, even inside another word
            // e.g. "cat" matches "concatenate" — worth less than exact
            const partialMatches = (content.match(new RegExp(word, 'g')) || []).length;
            score += Math.max(0, partialMatches - exactMatches) * 1.5; // partial matches worth 1.5 points
        }
        
        // Bonus: if multiple query words appear in the same chunk, it's probably very relevant
        // should be queryWords.filter() instead of query.filter()
        const uniqueWordsFound = queryWords.filter(word => content.includes(word)).length;
        if(uniqueWordsFound > 1) {
            score += uniqueWordsFound * 2; // extra points for each additional query word found
        }

        // Normalize score by chunk length so longer chunks don't unfairly dominate
        // e.g. a 1000 word chunk will naturally contain more matches than a 50 word chunk
        // dividing by sqrt of word count levels the playing field
        const normalizedScore = score / Math.sqrt(contentWords);

        // Small bonus for chunks that appear earlier in the document
        // intro/summary sections tend to be more relevant than later details
        const positionBonus = 1 - (index / chunks.length) * 0.1;

        // Return the chunk with its score info attached
        // stripping mongoose metadata (_doc etc) by only returning what we need
        return {
            content: chunk.content,
            chunkIndex: chunk.chunkIndex,
            pageNumber: chunk.pageNumber,
            _id: chunk._id,
            score: normalizedScore * positionBonus, // final score used for sorting
            rawScore: score,                         // original score before normalization (useful for debugging)
            matchedWords: uniqueWordsFound           // how many query words were found in this chunk
        }
    });

    return scoredChunks
        .filter(chunk => chunk.score > 0)  // throw away chunks with no matches at all
        .sort((a, b) => {
            // Primary sort: higher score first
            if(b.score !== a.score) {
                return b.score - a.score;
            }
            // Tiebreaker 1: more matched query words wins
            if(b.matchedWords !== a.matchedWords) {
                return b.matchedWords - a.matchedWords;
            }
            // Tiebreaker 2: if still tied, preserve original document order
            return a.chunkIndex - b.chunkIndex;
        }) 
        .slice(0, maxChunks); // only return the top N most relevant chunks
};