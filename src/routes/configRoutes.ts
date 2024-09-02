import { Router } from 'express';
import { createConfiguration, deleteConfiguration, getConfigurations, updateConfiguration } from '../controllers/configController';

const router = Router();

router.get('/', getConfigurations);
router.post('/', createConfiguration);
router.put('/:id', updateConfiguration);
router.delete('/:id', deleteConfiguration);

export default router;
