import jwt from "jsonwebtoken";
const { sign, verify } = jwt;

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_development_only";

if (JWT_SECRET === "fallback_secret_for_development_only") {
    console.warn("ADVERTENCIA CRÍTICA: Estás usando la clave JWT de desarrollo por defecto. ¡Peligro en producción!");
}

const generateToken = (id: string, rol: string) => {
    const jwt = sign({ id, rol }, JWT_SECRET, {
        expiresIn: "2h",
    });
    return jwt;
};

const verifyToken = (jwt: string) => {
    const isOk = verify(jwt, JWT_SECRET);
    return isOk;
};

export { generateToken, verifyToken };
