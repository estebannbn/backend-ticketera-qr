# Ticketera QR - Backend

RESTful API providing services for the Ticketera QR platform. Handles user management, events, and QR ticket generation/validation.

## 🚀 Key Technologies

- **Environment:** Node.js
- **Language:** TypeScript
- **ORM:** [Prisma](https://www.prisma.io/)
- **Database:** PostgreSQL

## 📋 Prerequisites

Make sure you have the following installed:
- [Node.js](https://nodejs.org/en/)
- [PostgreSQL](https://www.postgresql.org/download/) (Optional, you can use Supabase or another database service)

## ⚙️ Initial Setup and Environment

1. Create your environment variables file by copying the provided example:
   ```bash
   cp .env.example .env
   ```
2. Fill in the variables in the `.env` file. A basic example:
   ```env
   # Prisma connection string
   DATABASE_URL="postgresql://user:password@localhost:5432/ticketera?schema=public"
   # API Port
   PORT=4000
   # Secret for signing JWT tokens
   JWT_SECRET="your_super_secret"
   ```

## 🗄️ Database and Prisma

Once your `.env` file is set up, prepare the database as follows:

1. Install project dependencies (if you haven't already):
   ```bash
   npm install
   ```
2. Apply migrations to create tables in your database:
   ```bash
   npx prisma migrate dev
   ```
3. Generate the Prisma client to use it in your code:
   ```bash
   npx prisma generate
   ```
*(Optional: If the project has a script to load initial or test data, you can run `npx prisma db seed`)*

## 🛠️ Local Execution

To start the server in development mode with hot-reloading:
```bash
npm run dev
```
The server should be responding to requests at `http://localhost:4000` (or the port you configured in the `.env` file).

## 📁 Project Structure

- `/prisma`: Contains the main database schema (`schema.prisma`) and migration history.
- `/src/controllers`: Functions that process incoming requests.
- `/src/routes`: Definition of API endpoints and HTTP methods.
- `/src/services`: Business rules and direct interaction with Prisma.
- `/src/middlewares`: Middleware functions (session handling and zod validations).
- `/src/schemas`: Zod validation schemas.
- `/src/utils`: Utility functions (encryption, email sending, JWT).

## 📚 API Documentation

*Note for devs: Add a link here to Swagger, exported Postman/Bruno collections, or a basic list of the main endpoints (e.g., `POST /api/auth/login`, `GET /api/tickets/:id`).*
