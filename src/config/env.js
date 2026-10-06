import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || "development",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  authSecret: process.env.AUTH_SECRET || "dev-only-insecure-secret-change-me",
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS) || 12,

  // MySQL connection — see database/schema.sql to create and seed the DB.
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    name: process.env.DB_NAME || "osaa_track",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    poolSize: Number(process.env.DB_POOL_SIZE) || 25,
  },

  // Optional SMTP for announcement emails — see .env.example for setup notes.
  email: {
    enabled: process.env.EMAIL_ENABLED === "true",
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    password: process.env.SMTP_PASSWORD || "",
    from: process.env.EMAIL_FROM || "OSAA-TRACK <no-reply@example.com>",
  },
};
