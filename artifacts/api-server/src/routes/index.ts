import { Router, type IRouter } from "express";
import healthRouter from "./health";
import uploadRouter from "./upload";
import mediaRouter from "./media";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/upload", uploadRouter);
router.use("/media", mediaRouter);
router.use("/settings", settingsRouter);

export default router;
