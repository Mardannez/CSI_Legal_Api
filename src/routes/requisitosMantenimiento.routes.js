import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { authorizeGlobalPermission } from "../middlewares/authorizeGlobalPermission.middleware.js";
import multer from 'multer';

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: RequisitosMantenimiento
 *     description: Mantenimiento de requisitos, referencias legales y leyes
 */

/*Para subir archivos con multer, de las leyes de requisitos legales */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
  fileFilter: (req, file, cb) => {
    const isPdfMime = file.mimetype === 'application/pdf';
    const hasPdfExtension = file.originalname.toLowerCase().endsWith('.pdf');

    if (!isPdfMime && !hasPdfExtension) {
      return cb(new Error('Solo se permiten archivos PDF'));
    }

    cb(null, true);
  },
});

function bufferToPostgresByteaHex(buffer) {
  return `\\x${buffer.toString('hex')}`;
}

function postgresByteaToBuffer(value) {
  if (!value) return Buffer.alloc(0);

  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === 'string') {
    if (value.startsWith('\\x')) {
      return Buffer.from(value.slice(2), 'hex');
    }

    if (value.startsWith('\\\\x')) {
      return Buffer.from(value.slice(3), 'hex');
    }

    return Buffer.from(value, 'base64');
  }

  throw new Error('Formato de bytea no soportado');
}

/*Fin Para subir archivos con multer, de las leyes de requisitos legales */



const ESTADOS_VALIDOS = new Set(["Vigente", "Inactivo", "Vencido"]);
/*Helper numerico */

function toInt(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * GET /api/requisitos-mantenimiento?countryId=&estado=&q=&page=&pageSize=
 * Listado (usa vw_RequisitoMantenimiento)
 */
/**
 * @swagger
 * /api/requisitos-mantenimiento:
 *   get:
 *     summary: Listar requisitos de mantenimiento
 *     tags: [RequisitosMantenimiento]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: countryId
 *         required: false
 *         schema:
 *           type: integer
 *       - in: query
 *         name: subCategoriaId
 *         required: false
 *         schema:
 *           type: integer
 *       - in: query
 *         name: estado
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: q
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: integer
 *       - in: query
 *         name: pageSize
 *         required: false
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Requisitos consultados
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get("/",requireAuth,authorizeGlobalPermission(["REQUISITOS_MANTENIMIENTO_VER"]),
  async (req, res) => {
    try {
      const countryId = toInt(req.query.countryId);
      const subCategoriaId = toInt(req.query.subCategoriaId);
      const estado = (req.query.estado || "").toString().trim();
      const q = (req.query.q || "").toString().trim();
      const page = Math.max(1, toInt(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(5, toInt(req.query.pageSize) || 20));

      let query = supabase
        .from("vw_RequisitoMantenimiento")
        .select("*", { count: "exact" })
        .order("NombreRequisito", { ascending: true });

      if (countryId) query = query.eq("IdPais", countryId);
      if (subCategoriaId) query = query.eq("IdSubCategoria", subCategoriaId);
      if (estado) query = query.eq("EstadoRequisito", estado);

      if (q) {
        query = query.or(
          `NombreRequisito.ilike.%${q}%,DescripcionRequisito.ilike.%${q}%,Categoria.ilike.%${q}%,Pais.ilike.%${q}%`
        );
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await query.range(from, to);

      if (error) {
        return res.status(500).json({
          message: "Error listando requisitos",
          detail: error.message,
        });
      }

      return res.json({
        Requisitos: data || [],
        Pagination: { page, pageSize, total: count || 0 },
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Error interno" });
    }
  }
);

/**
 * GET /api/requisitos-mantenimiento/:id
 */
/**
 * @swagger
 * /api/requisitos-mantenimiento/{id}:
 *   get:
 *     summary: Obtener requisito por id
 *     tags: [RequisitosMantenimiento]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Requisito consultado
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get("/:id",requireAuth,authorizeGlobalPermission(["REQUISITOS_MANTENIMIENTO_VER"]),
  async (req, res) => {
    try {
      const id = toInt(req.params.id);
      if (!id || id <= 0) {
        return res.status(400).json({ message: "id inválido" });
      }

      const { data, error } = await supabase
        .from("Requisito")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          message: "Error consultando requisito",
          detail: error.message,
        });
      }

      if (!data) {
        return res.status(404).json({ message: "Requisito no encontrado" });
      }

      return res.json({ Requisito: data });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Error interno" });
    }
  }
);

/**
 * POST /api/requisitos-mantenimiento
 */
/**
 * @swagger
 * /api/requisitos-mantenimiento:
 *   post:
 *     summary: Crear requisito de mantenimiento
 *     tags: [RequisitosMantenimiento]
 *     security:
 *       - bearerAuth: []
 *     parameters: []
 *     responses:
 *       201:
 *         description: Requisito creado
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post("/",requireAuth,authorizeGlobalPermission(["REQUISITOS_MANTENIMIENTO_CREAR"]),
  async (req, res) => {
    try {
      const body = req.body || {};

      const NombreRequisito = (body.NombreRequisito || "").toString().trim();
      const DescripcionRequisito = (body.DescripcionRequisito || "").toString().trim();
      const IdPais = toInt(body.IdPais);
      const IdSubCategoria = toInt(body.IdSubCategoria);
      const IdPeriocidad = toInt(body.IdPeriocidad);
      const ResponsableEjecucion = (body.ResponsableEjecucion || "").toString().trim();
      const EstadoRequisito = (body.EstadoRequisito || "Vigente").toString().trim();

      if (!NombreRequisito) {
        return res.status(400).json({ message: "NombreRequisito es requerido" });
      }
      if (!IdPais) {
        return res.status(400).json({ message: "IdPais es requerido" });
      }
      if (!IdSubCategoria) {
        return res.status(400).json({ message: "IdSubCategoria es requerido" });
      }
      if (!ESTADOS_VALIDOS.has(EstadoRequisito)) {
        return res.status(400).json({
          message: "EstadoRequisito inválido (Vigente/Inactivo/Vencido)",
        });
      }

      const payload = {
        NombreRequisito,
        DescripcionRequisito: DescripcionRequisito || null,
        IdPais,
        IdSubCategoria,
        IdPeriocidad: IdPeriocidad || null,
        ResponsableEjecucion: ResponsableEjecucion || null,
        EstadoRequisito,
        FechaRegistro: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("Requisito")
        .insert(payload)
        .select("*")
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error creando requisito",
          detail: error.message,
        });
      }

      return res.status(201).json({
        message: "Requisito creado",
        Requisito: data,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Error interno" });
    }
  }
);

/**
 * PUT /api/requisitos-mantenimiento/:id
 */
/**
 * @swagger
 * /api/requisitos-mantenimiento/{id}:
 *   put:
 *     summary: Actualizar requisito de mantenimiento
 *     tags: [RequisitosMantenimiento]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Requisito actualizado
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.put("/:id",requireAuth,authorizeGlobalPermission(["REQUISITOS_MANTENIMIENTO_EDITAR"]),
  async (req, res) => {
    try {
      const id = toInt(req.params.id);
      if (!id || id <= 0) {
        return res.status(400).json({ message: "id inválido" });
      }

      const body = req.body || {};

      const NombreRequisito = (body.NombreRequisito || "").toString().trim();
      const DescripcionRequisito = (body.DescripcionRequisito || "").toString().trim();
      const IdPais = toInt(body.IdPais);
      const IdSubCategoria = toInt(body.IdSubCategoria);
      const IdPeriocidad = toInt(body.IdPeriocidad);
      const ResponsableEjecucion = (body.ResponsableEjecucion || "").toString().trim();
      const EstadoRequisito = (body.EstadoRequisito || "").toString().trim();

      if (!NombreRequisito) {
        return res.status(400).json({ message: "NombreRequisito es requerido" });
      }
      if (!IdPais) {
        return res.status(400).json({ message: "IdPais es requerido" });
      }
      if (!IdSubCategoria) {
        return res.status(400).json({ message: "IdSubCategoria es requerido" });
      }
      if (!ESTADOS_VALIDOS.has(EstadoRequisito)) {
        return res.status(400).json({
          message: "EstadoRequisito inválido (Vigente/Inactivo/Vencido)",
        });
      }

      const payload = {
        NombreRequisito,
        DescripcionRequisito: DescripcionRequisito || null,
        IdPais,
        IdSubCategoria,
        IdPeriocidad: IdPeriocidad || null,
        ResponsableEjecucion: ResponsableEjecucion || null,
        EstadoRequisito,
      };

      const { data, error } = await supabase
        .from("Requisito")
        .update(payload)
        .eq("id", id)
        .select("*")
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error actualizando requisito",
          detail: error.message,
        });
      }

      return res.json({
        message: "Requisito actualizado",
        Requisito: data,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Error interno" });
    }
  }
);

/**
 * DELETE /api/requisitos-mantenimiento/:id
 */
/**
 * @swagger
 * /api/requisitos-mantenimiento/{id}:
 *   delete:
 *     summary: Inactivar requisito de mantenimiento
 *     tags: [RequisitosMantenimiento]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Requisito inactivado
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.delete("/:id",requireAuth,authorizeGlobalPermission(["REQUISITOS_MANTENIMIENTO_ELIMINAR"]),
  async (req, res) => {
    try {
      const id = toInt(req.params.id);
      if (!id || id <= 0) {
        return res.status(400).json({ message: "id inválido" });
      }

      const { data, error } = await supabase
        .from("Requisito")
        .update({ EstadoRequisito: "Inactivo" })
        .eq("id", id)
        .select("id,EstadoRequisito")
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error eliminando (inactivando) requisito",
          detail: error.message,
        });
      }

      return res.json({
        message: "Requisito inactivado",
        Requisito: data,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Error interno" });
    }
  }
);


/**
 * POST /api/referencias-legales
 * Guardar las referencias Legales de cada requisito.
 */

/**
 * @swagger
 * /api/requisitos-mantenimiento/referencias-legales/{idReferenciaLegal}/leyes:
 *   post:
 *     summary: Cargar PDF de ley para una referencia legal
 *     tags: [RequisitosMantenimiento]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idReferenciaLegal
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Ley cargada
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/referencias-legales/:idReferenciaLegal/leyes', requireAuth,authorizeGlobalPermission(['REQUISITOS_MANTENIMIENTO_EDITAR']),
  upload.single('documento'),
  async (req, res) => {
    try {
      const idReferenciaLegal = Number(req.params.idReferenciaLegal);
      const nombreLey = (req.body?.nombreLey || '').toString().trim();
      const file = req.file;

      if (!Number.isInteger(idReferenciaLegal) || idReferenciaLegal <= 0) {
        return res.status(400).json({
          message: 'idReferenciaLegal inválido',
        });
      }

      if (!nombreLey) {
        return res.status(400).json({
          message: 'nombreLey es requerido',
        });
      }

      if (!file) {
        return res.status(400).json({
          message: 'Debe adjuntar un PDF en el campo "documento"',
        });
      }

      // 1) Validar que la referencia legal exista
      const { data: referencia, error: referenciaError } = await supabase
        .from('ReferenciaLegal')
        .select('id, IdRequisito')
        .eq('id', idReferenciaLegal)
        .maybeSingle();

      if (referenciaError) {
        return res.status(500).json({
          message: 'Error validando la referencia legal',
          detail: referenciaError.message,
        });
      }

      if (!referencia) {
        return res.status(404).json({
          message: 'ReferenciaLegal no encontrada',
        });
      }

      // 2) Convertir el PDF a formato hex para bytea
      const documentoBytea = bufferToPostgresByteaHex(file.buffer);

      // 3) Insertar en Ley
      const { data: leyInsertada, error: insertError } = await supabase
        .from('Ley')
        .insert({
          IdReferenciaLegal: idReferenciaLegal,
          NombreLey: nombreLey,
          Documento: documentoBytea,
        })
        .select('id, IdReferenciaLegal, NombreLey')
        .single();

      if (insertError) {
        return res.status(500).json({
          message: 'Error guardando la ley',
          detail: insertError.message,
        });
      }

      return res.status(201).json({
        message: 'Ley cargada correctamente',
        Ley: leyInsertada,
      });
    } catch (error) {
      console.error('POST /referencias-legales/:idReferenciaLegal/leyes error:', error);

      if (error?.message === 'Solo se permiten archivos PDF') {
        return res.status(400).json({
          message: error.message,
        });
      }

      return res.status(500).json({
        message: 'Error interno al cargar la ley',
        detail: error.message,
      });
    }
  }
);

/**
 * GET /api/referencias-legales
 * Endpoint para listar leyes de una referencia legal
 */
/**
 * @swagger
 * /api/requisitos-mantenimiento/referencias-legales/{idReferenciaLegal}/leyes:
 *   get:
 *     summary: Listar leyes de una referencia legal
 *     tags: [RequisitosMantenimiento]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idReferenciaLegal
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Leyes consultadas
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/referencias-legales/:idReferenciaLegal/leyes',requireAuth,authorizeGlobalPermission(['REQUISITOS_MANTENIMIENTO_VER']),
  async (req, res) => {
    try {
      const idReferenciaLegal = Number(req.params.idReferenciaLegal);

      if (!Number.isInteger(idReferenciaLegal) || idReferenciaLegal <= 0) {
        return res.status(400).json({
          message: 'idReferenciaLegal inválido',
        });
      }

      const { data, error } = await supabase
        .from('Ley')
        .select('id, IdReferenciaLegal, NombreLey')
        .eq('IdReferenciaLegal', idReferenciaLegal)
        .order('id', { ascending: true });

      if (error) {
        return res.status(500).json({
          message: 'Error consultando leyes',
          detail: error.message,
        });
      }

      return res.json({
        Leyes: data || [],
      });
    } catch (error) {
      console.error('GET /referencias-legales/:idReferenciaLegal/leyes error:', error);

      return res.status(500).json({
        message: 'Error interno consultando leyes',
        detail: error.message,
      });
    }
  }
);

/**
 * GET /api/leyes
 * Endpoint para descargar el PDF
 */

/**
 * @swagger
 * /api/requisitos-mantenimiento/leyes/{id}/download:
 *   get:
 *     summary: Descargar PDF de una ley
 *     tags: [RequisitosMantenimiento]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: PDF de ley
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/leyes/:id/download',requireAuth,authorizeGlobalPermission(['REQUISITOS_MANTENIMIENTO_VER']),
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          message: 'id inválido',
        });
      }

      const { data: ley, error } = await supabase
        .from('Ley')
        .select('id, NombreLey, Documento')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          message: 'Error consultando la ley',
          detail: error.message,
        });
      }

      if (!ley) {
        return res.status(404).json({
          message: 'Ley no encontrada',
        });
      }

      const fileBuffer = postgresByteaToBuffer(ley.Documento);

      const safeName = `${ley.NombreLey || 'documento'}`.replace(/[^\w\-]+/g, '_');

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${safeName}.pdf"`
      );

      return res.send(fileBuffer);
    } catch (error) {
      console.error('GET /leyes/:id/download error:', error);

      return res.status(500).json({
        message: 'Error interno descargando PDF',
        detail: error.message,
      });
    }
  }
);

/**
 * DELETED /api/leyes
 * Endpoint Eliminar una ley
 */

/**
 * @swagger
 * /api/requisitos-mantenimiento/leyes/{id}:
 *   delete:
 *     summary: Eliminar ley
 *     tags: [RequisitosMantenimiento]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Ley eliminada
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.delete('/leyes/:id',requireAuth, authorizeGlobalPermission(['REQUISITOS_MANTENIMIENTO_EDITAR']),
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          message: 'id inválido',
        });
      }

      const { data, error } = await supabase
        .from('Ley')
        .delete()
        .eq('id', id)
        .select('id, NombreLey')
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          message: 'Error eliminando la ley',
          detail: error.message,
        });
      }

      if (!data) {
        return res.status(404).json({
          message: 'Ley no encontrada',
        });
      }

      return res.json({
        message: 'Ley eliminada correctamente',
        Ley: data,
      });
    } catch (error) {
      console.error('DELETE /leyes/:id error:', error);

      return res.status(500).json({
        message: 'Error interno eliminando la ley',
        detail: error.message,
      });
    }
  }
);

/**
 * POST  '/requisitos/:idRequisito/referencias-legales'
 * Crear una referencia Legal
 */

/**
 * @swagger
 * /api/requisitos-mantenimiento/requisitos/{idRequisito}/referencias-legales:
 *   post:
 *     summary: Crear referencia legal para un requisito
 *     tags: [RequisitosMantenimiento]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idRequisito
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Referencia legal creada
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/requisitos/:idRequisito/referencias-legales',requireAuth,authorizeGlobalPermission(['REQUISITOS_MANTENIMIENTO_EDITAR']),
  async (req, res) => {
    try {
      const idRequisito = toInt(req.params.idRequisito);

      if (!idRequisito || idRequisito <= 0) {
        return res.status(400).json({
          message: 'idRequisito inválido',
        });
      }

      const Ambito = (req.body?.Ambito || '').toString().trim();
      const Articulo = (req.body?.Articulo || '').toString().trim();
      const Ley = (req.body?.Ley || '').toString().trim();
      const Modificaciones = (req.body?.Modificaciones || '').toString().trim();
      const Contenido = (req.body?.Contenido ?? req.body?.contenido ?? '').toString().trim();

      if (!Ambito) {
        return res.status(400).json({ message: 'Ambito es requerido' });
      }

      if (!Articulo) {
        return res.status(400).json({ message: 'Articulo es requerido' });
      }

      if (!Ley) {
        return res.status(400).json({ message: 'Ley es requerida' });
      }

      // Validar que el requisito exista
      const { data: requisito, error: requisitoError } = await supabase
        .from('Requisito')
        .select('id, NombreRequisito')
        .eq('id', idRequisito)
        .maybeSingle();

      if (requisitoError) {
        return res.status(500).json({
          message: 'Error validando el requisito',
          detail: requisitoError.message,
        });
      }

      if (!requisito) {
        return res.status(404).json({
          message: 'Requisito no encontrado',
        });
      }

      const { data, error } = await supabase
        .from('ReferenciaLegal')
        .insert({
          IdRequisito: idRequisito,
          Ambito,
          Articulo,
          Ley,
          Modificaciones: Modificaciones || null,
          Contenido: Contenido || null,
          FechaRegistro: new Date().toISOString(),
        })
        .select('*')
        .single();

      if (error) {
        return res.status(500).json({
          message: 'Error creando referencia legal',
          detail: error.message,
        });
      }

      return res.status(201).json({
        message: 'Referencia legal creada correctamente',
        ReferenciaLegal: data,
      });
    } catch (error) {
      console.error('POST /requisitos/:idRequisito/referencias-legales error:', error);

      return res.status(500).json({
        message: 'Error interno creando referencia legal',
        detail: error.message,
      });
    }
  }
);
/**
 * GET '/requisitos/:idRequisito/referencias-legales'
 * Listar referencias legales por requisito
 */

/**
 * @swagger
 * /api/requisitos-mantenimiento/requisitos/{idRequisito}/referencias-legales:
 *   get:
 *     summary: Listar referencias legales de un requisito
 *     tags: [RequisitosMantenimiento]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idRequisito
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Referencias legales consultadas
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/requisitos/:idRequisito/referencias-legales',requireAuth,authorizeGlobalPermission(['REQUISITOS_MANTENIMIENTO_VER']),
  async (req, res) => {
    try {
      const idRequisito = toInt(req.params.idRequisito);

      if (!idRequisito || idRequisito <= 0) {
        return res.status(400).json({
          message: 'idRequisito inválido',
        });
      }

      const { data, error } = await supabase
        .from('ReferenciaLegal')
        .select('*')
        .eq('IdRequisito', idRequisito)
        .order('id', { ascending: true });

      if (error) {
        return res.status(500).json({
          message: 'Error consultando referencias legales',
          detail: error.message,
        });
      }

      return res.json({
        ReferenciasLegales: data || [],
      });
    } catch (error) {
      console.error('GET /requisitos/:idRequisito/referencias-legales error:', error);

      return res.status(500).json({
        message: 'Error interno consultando referencias legales',
        detail: error.message,
      });
    }
  }
);

/**
 * GET  '/referencias-legales/:id'
 * Obtener una referencia legal por id
 */
/**
 * @swagger
 * /api/requisitos-mantenimiento/referencias-legales/{id}:
 *   get:
 *     summary: Obtener referencia legal por id
 *     tags: [RequisitosMantenimiento]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Referencia legal consultada
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/referencias-legales/:id',requireAuth,authorizeGlobalPermission(['REQUISITOS_MANTENIMIENTO_VER']), async (req, res) => {
    try {
      const id = toInt(req.params.id);

      if (!id || id <= 0) {
        return res.status(400).json({
          message: 'id inválido',
        });
      }

      const { data, error } = await supabase
        .from('ReferenciaLegal')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          message: 'Error consultando referencia legal',
          detail: error.message,
        });
      }

      if (!data) {
        return res.status(404).json({
          message: 'Referencia legal no encontrada',
        });
      }

      return res.json({
        ReferenciaLegal: data,
      });
    } catch (error) {
      console.error('GET /referencias-legales/:id error:', error);

      return res.status(500).json({
        message: 'Error interno consultando referencia legal',
        detail: error.message,
      });
    }
  }
);
/**
 * PUT  '/referencias-legales/:id'
 * Editar referencia legal
 */
/**
 * @swagger
 * /api/requisitos-mantenimiento/referencias-legales/{id}:
 *   put:
 *     summary: Actualizar referencia legal
 *     tags: [RequisitosMantenimiento]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Referencia legal actualizada
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.put('/referencias-legales/:id',requireAuth,authorizeGlobalPermission(['REQUISITOS_MANTENIMIENTO_EDITAR']),  async (req, res) => {
    try {
      const id = toInt(req.params.id);

      if (!id || id <= 0) {
        return res.status(400).json({
          message: 'id inválido',
        });
      }

      const Ambito = (req.body?.Ambito || '').toString().trim();
      const Articulo = (req.body?.Articulo || '').toString().trim();
      const Ley = (req.body?.Ley || '').toString().trim();
      const Modificaciones = (req.body?.Modificaciones || '').toString().trim();
      const Contenido = (req.body?.Contenido ?? req.body?.contenido ?? '').toString().trim();

      if (!Ambito) {
        return res.status(400).json({ message: 'Ambito es requerido' });
      }

      if (!Articulo) {
        return res.status(400).json({ message: 'Articulo es requerido' });
      }

      if (!Ley) {
        return res.status(400).json({ message: 'Ley es requerida' });
      }

      const { data, error } = await supabase
        .from('ReferenciaLegal')
        .update({
          Ambito,
          Articulo,
          Ley,
          Modificaciones: Modificaciones || null,
          Contenido: Contenido || null,
        })
        .eq('id', id)
        .select('*')
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          message: 'Error actualizando referencia legal',
          detail: error.message,
        });
      }

      if (!data) {
        return res.status(404).json({
          message: 'Referencia legal no encontrada',
        });
      }

      return res.json({
        message: 'Referencia legal actualizada correctamente',
        ReferenciaLegal: data,
      });
    } catch (error) {
      console.error('PUT /referencias-legales/:id error:', error);

      return res.status(500).json({
        message: 'Error interno actualizando referencia legal',
        detail: error.message,
      });
    }
  }
);

/**
 * DELETE  '/referencias-legales/:id'
 * Eliminar referencia legal
 */

/**
 * @swagger
 * /api/requisitos-mantenimiento/referencias-legales/{id}:
 *   delete:
 *     summary: Eliminar referencia legal
 *     tags: [RequisitosMantenimiento]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Referencia legal eliminada
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: La referencia legal tiene leyes relacionadas
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.delete('/referencias-legales/:id',requireAuth,authorizeGlobalPermission(['REQUISITOS_MANTENIMIENTO_EDITAR']),  async (req, res) => {
    try {
      const id = toInt(req.params.id);

      if (!id || id <= 0) {
        return res.status(400).json({
          message: 'id inválido',
        });
      }

      // 1) Validar si tiene leyes relacionadas
      const { data: leyes, error: leyesError } = await supabase
        .from('Ley')
        .select('id')
        .eq('IdReferenciaLegal', id);

      if (leyesError) {
        return res.status(500).json({
          message: 'Error validando leyes relacionadas',
          detail: leyesError.message,
        });
      }

      if ((leyes || []).length > 0) {
        return res.status(409).json({
          message: 'No se puede eliminar la referencia legal porque tiene leyes relacionadas',
          totalLeyes: leyes.length,
        });
      }

      // 2) Eliminar la referencia legal
      const { data, error } = await supabase
        .from('ReferenciaLegal')
        .delete()
        .eq('id', id)
        .select('*')
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          message: 'Error eliminando referencia legal',
          detail: error.message,
        });
      }

      if (!data) {
        return res.status(404).json({
          message: 'Referencia legal no encontrada',
        });
      }

      return res.json({
        message: 'Referencia legal eliminada correctamente',
        ReferenciaLegal: data,
      });
    } catch (error) {
      console.error('DELETE /referencias-legales/:id error:', error);

      return res.status(500).json({
        message: 'Error interno eliminando referencia legal',
        detail: error.message,
      });
    }
  }
);

export default router;
