import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import "dotenv/config";

import authRoutes from "./routes/auth.routes.js";
import paisesRoutes from "./routes/paises.routes.js";
import empresasRoutes from "./routes/empresas.routes.js";
import evaluacionesRoutes from "./routes/evaluaciones.routes.js";
import requisitosRoutes from "./routes/requisitos.routes.js";
import estadosRequisitoRoutes from "./routes/estadosRequisito.routes.js";
import requisitosMantenimientoRoutes from "./routes/requisitosMantenimiento.routes.js"
import periocidadRoutes from "./routes/periocidad.routes.js";
import subcategoriasRoutes from "./routes/subcategorias.routes.js";

const app = express();

app.use(helmet());
app.use(morgan("dev"));


app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
   // origin: process.env.FRONTEND_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
});

app.use(express.json());
app.get('/', (req, res) => {
  res.json({ message: 'CSI Legal API funcionando' });
});


app.use("/api/auth", authLimiter);

app.use("/api/auth", authRoutes);

app.get("/health", (_, res) => res.json({ ok: true, api: "CSI_Legal_Api" }));
/* Llamado de metodo de paises en mis routes */
app.use("/api/paises", paisesRoutes);
/* Llamado del metodo de Empresas por pais */
app.use("/api/empresas", empresasRoutes);
/* Llamado del metodo Iniciar Evaluacion y Detalle de Evaluacion */
app.use("/api/evaluaciones", evaluacionesRoutes);
app.use("/api/requisitos", requisitosRoutes);
app.use("/api/estados-requisito", estadosRequisitoRoutes);
app.use("/api/requisitos-mantenimiento", requisitosMantenimientoRoutes);
app.use("/api/periocidad", periocidadRoutes);
app.use("/api/subcategorias", subcategoriasRoutes);

const port = process.env.PORT || 4000;
//app.listen(port, () => console.log(`CSI_Legal_Api running on port ${port}`)); En Vercel no se nmecsita esto

export default app;