import { Rol } from "@prisma/client";
import { prisma } from "../prisma.js";
import { Request, Response } from "express";
import { encrypt, verified } from "../utils/handleCrypt.js";
import { generateToken } from "../utils/jwt.handle.js";
import * as crypto from "crypto";
import { sendPasswordResetEmail } from "../services/emailService.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = "America/Argentina/Buenos_Aires";

// Solo crea ADMINS
const crearUsuario = async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userPayload = req.user;
    if (!userPayload || userPayload.rol !== Rol.ADMIN) {
      res.status(403).json({ message: "No tienes permiso para crear usuarios administradores", error: true });
      return;
    }

    const { mail, contraseña } = req.body;
    const hashedPassword = await encrypt(contraseña);
    const usuario = await prisma.usuario.create({
      data: {
        mail,
        contraseña: hashedPassword,
        rol: Rol.ADMIN,
      },
    });
    res.status(201).json({
      message: "Usuario creado exitosamente",
      data: {
        idUsuario: usuario.idUsuario,
        mail: usuario.mail,
        rol: usuario.rol
      },
      error: false,
    });
  } catch (error) {
    console.error("Error en crearUsuario:", error);
    res.status(500).json({
      message: "Error al crear el usuario",
      error: true,
      details: (error as Error).message,
    });
  }
};

const obtenerUsuario = async (req: Request, res: Response) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      select: {
        idUsuario: true,
        mail: true,
        rol: true
      }
    });
    res.json({ data: usuarios }); // <- esto es clave
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
};

const loginUsuario = async (req: Request, res: Response): Promise<void> => {
  try {
    const { mail, contraseña } = req.body;

    const usuario = await prisma.usuario.findUnique({
      where: { mail },
    });

    if (!usuario) {
      res.status(401).json({
        message: "Usuario o contraseña incorrectos",
        error: true,
      });
      return;
    }

    const contraseñaCorrecta = await verified(contraseña, usuario.contraseña);

    if (!contraseñaCorrecta) {
      res.status(401).json({
        message: "Usuario o contraseña incorrectos",
        error: true,
      });
      return;
    }

    const token = generateToken(String(usuario.idUsuario), usuario.rol);

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000, // 1 dia
    });

    res.status(200).json({
      message: "Login exitoso",
      error: false,
    });
  } catch (error) {
    console.error("Error en loginUsuario:", error);
    res.status(500).json({
      message: "Error al hacer login",
      error: true,
      details: (error as Error).message,
    });
  }
};

const logoutUsuario = (req: Request, res: Response) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });
  res.status(200).json({ message: "Logout exitoso" });
};


const getUsuarioLogueado = async (req: Request, res: Response): Promise<void> => {
  try {
    // @ts-ignore
    const userPayload = req.user;

    if (!userPayload || !userPayload.id) {
      res.status(200).json(null);
      return;
    }

    const usuarioData = await prisma.usuario.findUnique({
      where: { idUsuario: Number(userPayload.id) },
      select: {
        idUsuario: true,
        mail: true,
        rol: true,
      }
    });

    if (!usuarioData) {
      res.status(404).send("USUARIO_NO_ENCONTRADO");
      return;
    }

    res.status(200).json(usuarioData);
  } catch (e) {
    console.error("Error en getUsuarioLogueado:", e);
    res.status(500).send("ERROR_CHECK_SESSION");
  }
}

const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { mail } = req.body;

    const usuario = await prisma.usuario.findUnique({ where: { mail } });
    if (!usuario) {
      // Por seguridad, no revelamos si el usuario existe o no
    res.status(200).json({ message: "Si el correo electrónico se encuentra en nuestros registros, recibirá un enlace de recuperación a la brevedad.", error: false });
      return;
    }

    const token = crypto.randomBytes(20).toString('hex');
    const expires = dayjs().add(1, 'hour').toDate(); // 1 hora

    await prisma.usuario.update({
      where: { idUsuario: usuario.idUsuario },
      data: {
        resetToken: token,
        resetTokenExpires: expires
      }
    });

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await sendPasswordResetEmail(mail, resetUrl);

    res.status(200).json({ message: "Si el correo está registrado, recibirás un enlace", error: false });
  } catch (error) {
    console.error("Error en forgotPassword:", error);
    res.status(500).json({ message: "Error al enviar el mail", error: true });
  }
};

const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, nuevaContraseña } = req.body;

    const usuario = await prisma.usuario.findUnique({
      where: {
        resetToken: token as string
      }
    });

    if (!usuario || !usuario.resetTokenExpires || dayjs().isAfter(dayjs(usuario.resetTokenExpires))) {
      res.status(400).json({ message: "Token inválido o expirado", error: true });
      return;
    }

    const hashedPassword = await encrypt(nuevaContraseña);

    await prisma.usuario.update({
      where: { idUsuario: usuario.idUsuario },
      data: {
        contraseña: hashedPassword,
        resetToken: null,
        resetTokenExpires: null
      }
    });

    res.status(200).json({ message: "Contraseña reseteada con éxito", error: false });
  } catch (error) {
    console.error("Error en resetPassword:", error);
    res.status(500).json({ message: "Error al resetear la contraseña", error: true });
  }
};

const actualizarUsuario = async (req: Request, res: Response): Promise<void> => {
  try {
    const { idUsuario } = req.params;
    const { mail, contraseña } = req.body;

    const data: any = {};
    if (mail) data.mail = mail;
    if (contraseña) data.contraseña = await encrypt(contraseña);

    const usuario = await prisma.usuario.update({
      where: { idUsuario: Number(idUsuario) },
      data,
    });

    res.status(200).json({
      message: "Usuario actualizado",
      data: {
        idUsuario: usuario.idUsuario,
        mail: usuario.mail,
        rol: usuario.rol
      },
      error: false,
    });
  } catch (error) {
    console.error("Error en actualizarUsuario:", error);
    res.status(500).json({
      message: "Error al actualizar usuario",
      error: true,
      details: (error as Error).message,
    });
  }
};

export default { crearUsuario, obtenerUsuario, loginUsuario, getUsuarioLogueado, logoutUsuario, forgotPassword, resetPassword, actualizarUsuario };
