import fs from 'fs/promises';
import { PDFParse } from 'pdf-parse';

/**
 * Extract text from a PDF file
 * @param {string} filepath - The path to the PDF file
 * @returns {Promise<{ text: string, numPages: number }>} - A promise resolving to the extracted text and page count
 */
export const extractTextFromPDF = async (filepath) => {
    try {
        const dataBuffer = await fs.readFile(filepath);
        //pdfparse expects a Uint8Array, so we convert the buffer to that format
        const parser = new PDFParse(new Uint8Array(dataBuffer));
        const data = await parser.getText();

        return { text: data.text, numPages: data.numpages, info: data.info };

    } catch (error) {
        console.log("Error extracting text from PDF:", error);
        throw new Error('Error extracting text from PDF');
    }
};