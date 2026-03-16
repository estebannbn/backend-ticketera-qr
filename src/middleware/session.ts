import { NextFunction, Request, Response } from "express";
import { verifyToken } from "../utils/jwt.handle.js";

interface RequestExt extends Request {
    user?: string | object;
}

const checkSession = (req: RequestExt, res: Response, next: NextFunction) => {
    try {
        const jwt = req.cookies.token || "";

        if (jwt) {
            const isUser = verifyToken(`${jwt}`);
            if (isUser) {
                req.user = isUser;
            }
        }
    } catch (e) {
        console.log("Error verificando sesión (bypass activo):", e);
    }
    next();
};

export { checkSession };
