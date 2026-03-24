import express from 'express'
import{getFlashcards, getAllFlashcardSets, reviewFlashcards, toggleStarFlashcards, deleteFlashcardSets} from '../controllers/flashcardController.js'
import protect from '../middleware/auth.js'

const router = express.Router();

//All routes are protected
router.use(protect);

router.get('/', getAllFlashcardSets);
router.post('/:documentId', getFlashcards);
router.get('/:cardId/review', reviewFlashcards);
router.get('/:cardId/star', toggleStarFlashcards);
router.delete('/:id', deleteFlashcardSets);

export default router;
