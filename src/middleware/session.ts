import { NextFunction, Request, Response } from "express";
import { verifyToken } from "../utils/jwt.handle.js";

interface RequestExt extends Request {
    user?: string | object;
}

const checkSession = (req: RequestExt, res: Response, next: NextFunction) => {
    try {
        const jwt = req.cookies.token || "";
        const isMeRoute = req.originalUrl.endsWith('/me');

        if (jwt) {
            const isUser = verifyToken(`${jwt}`);
            if (isUser) {
                req.user = isUser;
                return next();
            }
        }

        if (isMeRoute) {
            return next();
        }
        res.status(401).json({ message: "No autorizado", error: true });
        return;
    } catch (e) {
        console.log("Error verificando sesión:", (e as Error).message);
        if (req.originalUrl.endsWith('/me')) {
            return next();
        }
        res.status(401).json({ message: "Token inválido", error: true });
        return;
    }
};

export { checkSession };
