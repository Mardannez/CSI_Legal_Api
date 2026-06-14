import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import {getActiveLicensesByEmpresaIds, buildLicenseMap,} from "../helpers/licencias.helper.js";


const router = Router();

const loginSchema = z.object({
  usuario: z.string().trim().min(3),
  password: z.string().min(4),
});

/* Ruta de Login al sistema */
/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Iniciar sesión
 *     description: Autentica al usuario y devuelve un token JWT.
 *     tags:
 *       - Auth
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - usuario
 *               - password
 *             properties:
 *               usuario:
 *                 type: string
 *                 example: admin
 *               password:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Login correcto
 *       401:
 *         description: Credenciales inválidas
 *       500:
 *         description: Error interno del servidor
 */
router.post("/login", async (req, res) => {
  try {
    const body = loginSchema.parse(req.body);
    const loginDebug = process.env.LOGIN_DEBUG === "true" || process.env.NODE_ENV !== "production";

    const { data: user, error } = await supabase
      .from("Usuarios")
      .select('id, "Usuario", "Password", "Estado"')
      .eq("Usuario", body.usuario)
      .maybeSingle();

    if (error) {
      console.error("Login user lookup error:", error.message);
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    if (!user) {
      if (loginDebug) {
        console.log("Login diagnostic:", {
          usuario: body.usuario,
          userFound: false,
        });
      }

      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    if (loginDebug) {
      console.log("Login diagnostic:", {
        usuario: body.usuario,
        userFound: true,
        estado: user.Estado,
        hasPasswordHash: Boolean(user.Password),
        passwordHashType: user.Password?.startsWith("$2") ? "bcrypt" : "unknown",
      });
    }

    if (user.Estado !== 1) {
      return res.status(403).json({ message: "Usuario inactivo" });
    }

    const ok = await bcrypt.compare(body.password, user.Password);
    if (loginDebug) {
      console.log("Login password diagnostic:", {
        usuario: body.usuario,
        passwordOk: ok,
      });
    }

    if (!ok) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    // ==========================================================
    // LICENCIAS DE EMPRESA
    // Primero validamos si el usuario es SUPER_ADMIN.
    // El SUPER_ADMIN puede entrar aunque las licencias de empresas
    // estén vencidas, suspendidas o no existan.
    // ==========================================================
    const { data: isGlobalAdminData, error: isGlobalAdminError } =
      await supabase.rpc("fn_es_admin_global", {
        p_id_usuario: user.id,
      });

    if (isGlobalAdminError) {
      throw isGlobalAdminError;
    }

    const isGlobalAdmin = isGlobalAdminData === true;

    // ==========================================================
    // LICENCIAS DE EMPRESA
    // Para usuarios NO globales, validamos que al menos una empresa
    // relacionada tenga licencia activa.
    // ==========================================================
    if (!isGlobalAdmin) {
      const { data: usuarioEmpresas, error: usuarioEmpresasError } = await supabase
        .from("UsuarioEmpresa")
        .select("IdEmpresa")
        .eq("IdUsuario", user.id)
        .eq("Estado", 1);

      if (usuarioEmpresasError) {
        throw usuarioEmpresasError;
      }

      const empresaIds = [
        ...new Set(
          (usuarioEmpresas || [])
            .map((x) => Number(x.IdEmpresa))
            .filter(Boolean)
        ),
      ];

      if (empresaIds.length === 0) {
        return res.status(403).json({
          ok: false,
          code: "USER_WITHOUT_COMPANY",
          message:
            "El usuario no tiene empresas activas asignadas. Contacte al administrador.",
        });
      }

      const licenciasActivas = await getActiveLicensesByEmpresaIds(empresaIds);

      if (licenciasActivas.length === 0) {
        return res.status(403).json({
          ok: false,
          code: "LICENSE_EXPIRED",
          message:
            "La licencia de la empresa ha vencido. Para continuar usando CSI Legal, debe renovar su licencia.",
        });
      }
    }

      const token = jwt.sign(
        {
          sub: user.id,
          usuario: user.Usuario,
          isGlobalAdmin,
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
      );

    return res.json({
      token,
      user: { id: user.id, usuario: user.Usuario },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return res.status(400).json({
        message: "Datos inválidos",
        issues: err.issues,
      });
    }

    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

function uniqueSorted(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

async function getActiveGlobalPermissionCodes(userId) {
  const { data: usuarioRoles, error: usuarioRolesError } = await supabase
    .from("UsuarioRolGlobal")
    .select('"IdRol"')
    .eq("IdUsuario", userId)
    .eq("Estado", 1);

  if (usuarioRolesError) throw usuarioRolesError;

  const roleIds = uniqueSorted((usuarioRoles || []).map((row) => Number(row.IdRol)));
  if (roleIds.length === 0) return [];

  const { data: roles, error: rolesError } = await supabase
    .from("Roles")
    .select('"IdRol"')
    .in("IdRol", roleIds)
    .eq("Estado", 1);

  if (rolesError) throw rolesError;

  const activeRoleIds = uniqueSorted((roles || []).map((row) => Number(row.IdRol)));
  if (activeRoleIds.length === 0) return [];

  return getActivePermissionCodesByRoleIds(activeRoleIds);
}

async function getActiveEmpresaPermissionRows(userId) {
  const { data: usuarioEmpresas, error: usuarioEmpresasError } = await supabase
    .from("UsuarioEmpresa")
    .select('"IdUsuarioEmpresa", "IdEmpresa"')
    .eq("IdUsuario", userId)
    .eq("Estado", 1);

  if (usuarioEmpresasError) throw usuarioEmpresasError;

  const usuarioEmpresaById = new Map(
    (usuarioEmpresas || []).map((row) => [
      Number(row.IdUsuarioEmpresa),
      Number(row.IdEmpresa),
    ])
  );
  const usuarioEmpresaIds = [...usuarioEmpresaById.keys()];
  if (usuarioEmpresaIds.length === 0) return [];

  const { data: usuarioEmpresaRoles, error: usuarioEmpresaRolesError } = await supabase
    .from("UsuarioEmpresaRol")
    .select('"IdUsuarioEmpresa", "IdRol"')
    .in("IdUsuarioEmpresa", usuarioEmpresaIds)
    .eq("Estado", 1);

  if (usuarioEmpresaRolesError) throw usuarioEmpresaRolesError;

  const roleIds = uniqueSorted((usuarioEmpresaRoles || []).map((row) => Number(row.IdRol)));
  if (roleIds.length === 0) return [];

  const permissionsByRoleId = await getActivePermissionCodesMapByRoleIds(roleIds);

  return (usuarioEmpresaRoles || []).flatMap((row) => {
    const idEmpresa = usuarioEmpresaById.get(Number(row.IdUsuarioEmpresa));
    const permisos = permissionsByRoleId.get(Number(row.IdRol)) || [];

    return permisos.map((permissionCode) => ({
      IdEmpresa: idEmpresa,
      PermisoCodigo: permissionCode,
    }));
  });
}

async function getActivePermissionCodesByRoleIds(roleIds = []) {
  const map = await getActivePermissionCodesMapByRoleIds(roleIds);
  return uniqueSorted([...map.values()].flat());
}

async function getActivePermissionCodesMapByRoleIds(roleIds = []) {
  const uniqueRoleIds = uniqueSorted(roleIds.map(Number).filter(Boolean));
  const result = new Map(uniqueRoleIds.map((roleId) => [roleId, []]));

  if (uniqueRoleIds.length === 0) return result;

  const { data: rolPermisos, error: rolPermisosError } = await supabase
    .from("RolPermiso")
    .select('"IdRol", "IdPermiso"')
    .in("IdRol", uniqueRoleIds)
    .eq("Estado", 1);

  if (rolPermisosError) throw rolPermisosError;

  const permisoIds = uniqueSorted((rolPermisos || []).map((row) => Number(row.IdPermiso)));
  if (permisoIds.length === 0) return result;

  const { data: permisos, error: permisosError } = await supabase
    .from("Permisos")
    .select('"IdPermiso", "Codigo"')
    .in("IdPermiso", permisoIds)
    .eq("Estado", 1);

  if (permisosError) throw permisosError;

  const permisosMap = new Map(
    (permisos || []).map((row) => [Number(row.IdPermiso), row.Codigo])
  );

  for (const row of rolPermisos || []) {
    const roleId = Number(row.IdRol);
    const permissionCode = permisosMap.get(Number(row.IdPermiso));

    if (permissionCode) {
      result.get(roleId)?.push(permissionCode);
    }
  }

  for (const [roleId, permissionCodes] of result.entries()) {
    result.set(roleId, uniqueSorted(permissionCodes));
  }

  return result;
}


/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Obtener sesión del usuario autenticado
 *     description: >
 *       Retorna la información del usuario autenticado, sus roles globales,
 *       permisos globales, empresas asignadas, roles/permisos por empresa,
 *       licencia activa de empresa y página inicial sugerida.
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sesión obtenida correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                           example: 1
 *                         usuario:
 *                           type: string
 *                           example: admin
 *                         nombreCompleto:
 *                           type: string
 *                           example: Administrador CSI Legal
 *                         correo:
 *                           type: string
 *                           nullable: true
 *                           example: admin@csilegal.com
 *                         estado:
 *                           type: integer
 *                           example: 1
 *                     rolesGlobales:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example:
 *                         - SUPER_ADMIN
 *                     permisosGlobales:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example:
 *                         - USUARIOS_VER
 *                         - USUARIOS_CREAR
 *                         - ROLES_VER
 *                     isGlobalAdmin:
 *                       type: boolean
 *                       example: true
 *                     empresaActivaSugerida:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         idEmpresa:
 *                           type: integer
 *                           example: 1
 *                         nombre:
 *                           type: string
 *                           example: Empresa Demo S.A.
 *                     empresas:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           idEmpresa:
 *                             type: integer
 *                             example: 1
 *                           nombre:
 *                             type: string
 *                             example: Empresa Demo S.A.
 *                           idPais:
 *                             type: integer
 *                             nullable: true
 *                             example: 1
 *                           pais:
 *                             type: string
 *                             nullable: true
 *                             example: Honduras
 *                           esPrincipal:
 *                             type: boolean
 *                             example: true
 *                           licencia:
 *                             type: object
 *                             nullable: true
 *                             properties:
 *                               id:
 *                                 type: integer
 *                                 example: 10
 *                               fechaInicio:
 *                                 type: string
 *                                 format: date
 *                                 example: "2026-01-01"
 *                               fechaFin:
 *                                 type: string
 *                                 format: date
 *                                 example: "2026-12-31"
 *                               estado:
 *                                 type: integer
 *                                 example: 1
 *                               tipoLicencia:
 *                                 type: string
 *                                 nullable: true
 *                                 example: ANUAL
 *                               maxUsuarios:
 *                                 type: integer
 *                                 nullable: true
 *                                 example: 10
 *                           roles:
 *                             type: array
 *                             items:
 *                               type: string
 *                             example:
 *                               - EMPRESA_ADMIN
 *                           permisos:
 *                             type: array
 *                             items:
 *                               type: string
 *                             example:
 *                               - EVALUACIONES_VER
 *                               - EVALUACIONES_EDITAR
 *                     landingPage:
 *                       type: string
 *                       example: /paises
 *       401:
 *         description: Token no enviado, inválido o expirado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Token no enviado o inválido
 *       403:
 *         description: Licencia vencida o no disponible para la empresa del usuario
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 code:
 *                   type: string
 *                   example: LICENSE_EXPIRED
 *                 message:
 *                   type: string
 *                   example: La licencia de la empresa ha vencido. Para continuar usando CSI Legal, debe renovar su licencia.
 *       404:
 *         description: Usuario no encontrado o inactivo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Usuario no encontrado o inactivo
 *       500:
 *         description: Error interno al obtener sesión
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Error interno al obtener sesión
 */

router.get("/me", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const [
      userResult,
      globalRolesResult,
      isGlobalAdminResult,
      usuarioEmpresaResult,
      empresaRolesResult,
      activeGlobalPermsResult,
      activeEmpresaPermsResult,
    ] = await Promise.all([
      supabase
        .from("Usuarios")
        .select("id, Usuario, NombreCompleto, Correo, Estado")
        .eq("id", userId)
        .eq("Estado", 1)
        .maybeSingle(),

      supabase
        .from("vw_UsuarioRolesGlobales")
        .select("RolCodigo")
        .eq("IdUsuario", userId),

      supabase.rpc("fn_es_admin_global", {
        p_id_usuario: userId,
      }),

      supabase
        .from("UsuarioEmpresa")
        .select("IdEmpresa, EsPrincipal")
        .eq("IdUsuario", userId)
        .eq("Estado", 1),

      supabase
        .from("vw_UsuarioRolesEmpresa")
        .select("IdEmpresa, RolCodigo")
        .eq("IdUsuario", userId),

      getActiveGlobalPermissionCodes(userId),

      getActiveEmpresaPermissionRows(userId),
    ]);

    if (userResult.error) throw userResult.error;
    if (globalRolesResult.error) throw globalRolesResult.error;
    if (isGlobalAdminResult.error) throw isGlobalAdminResult.error;
    if (usuarioEmpresaResult.error) throw usuarioEmpresaResult.error;
    if (empresaRolesResult.error) throw empresaRolesResult.error;

    const user = userResult.data;

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "Usuario no encontrado o inactivo",
      });
    }

    const rolesGlobales = uniqueSorted(
      (globalRolesResult.data || []).map((x) => x.RolCodigo)
    );

    const permisosGlobales = activeGlobalPermsResult;

    const isGlobalAdmin = isGlobalAdminResult.data === true;

    const usuarioEmpresas = usuarioEmpresaResult.data || [];
    const empresaIds = [
      ...new Set(
        usuarioEmpresas.map((x) => Number(x.IdEmpresa)).filter(Boolean)
      ),
    ];

    let empresasCatalogo = [];
    let paisesCatalogo = [];

    if (empresaIds.length > 0) {
      const { data: empresasData, error: empresasError } = await supabase
        .from("Empresas")
        .select("id, Nombre, IdPais")
        .in("id", empresaIds);

      if (empresasError) throw empresasError;

      empresasCatalogo = empresasData || [];

      const paisIds = [
        ...new Set(
          empresasCatalogo.map((x) => Number(x.IdPais)).filter(Boolean)
        ),
      ];

      if (paisIds.length > 0) {
        const { data: paisesData, error: paisesError } = await supabase
          .from("Paises")
          .select('id, "Pais"')
          .in("id", paisIds);

        if (paisesError) throw paisesError;

        paisesCatalogo = paisesData || [];
      }
    }

    const empresasMap = new Map(
      empresasCatalogo.map((e) => [Number(e.id), e])
    );

    const paisesMap = new Map(
      paisesCatalogo.map((p) => [Number(p.id), p])
    );

    const empresaRoles = empresaRolesResult.data || [];
    const empresaPermisos = activeEmpresaPermsResult;


      // ==========================================================
      // LICENCIAS DE EMPRESA
      // Si el usuario NO es SUPER_ADMIN, validamos las licencias activas
      // de sus empresas. El SUPER_ADMIN no depende de licencias.
      // ==========================================================
      let licenciasActivas = [];
      let licenciasMap = new Map();

      if (!isGlobalAdmin) {
        licenciasActivas = await getActiveLicensesByEmpresaIds(empresaIds);
        licenciasMap = buildLicenseMap(licenciasActivas);

        if (licenciasActivas.length === 0) {
          return res.status(403).json({
            ok: false,
            code: "LICENSE_EXPIRED",
            message:
              "La licencia de la empresa ha vencido. Para continuar usando CSI Legal, debe renovar su licencia.",
          });
        }
      }

        const empresas = usuarioEmpresas
          .map((ue) => {
            const idEmpresa = Number(ue.IdEmpresa);
            const empresa = empresasMap.get(idEmpresa);

            if (!empresa) return null;

            const pais = paisesMap.get(Number(empresa.IdPais));
            const licencia = licenciasMap.get(idEmpresa) || null;

            return {
              idEmpresa,
              nombre: empresa.Nombre,
              idPais: empresa.IdPais ? Number(empresa.IdPais) : null,
              pais: pais?.Pais ?? null,
              esPrincipal: ue.EsPrincipal === true,

              // ========================================================
              // LICENCIAS DE EMPRESA
              // SUPER_ADMIN no depende de licencia.
              // Usuarios de empresa solo reciben empresas con licencia activa.
              // ========================================================
              licencia: licencia
                ? {
                    id: Number(licencia.id),
                    fechaInicio: licencia.FechaInicio,
                    fechaFin: licencia.FechaFin,
                    estado: licencia.Estado,
                    tipoLicencia: licencia.TipoLicencia || null,
                    maxUsuarios: licencia.MaxUsuarios ?? null,
                  }
                : null,

              roles: uniqueSorted(
                empresaRoles
                  .filter((r) => Number(r.IdEmpresa) === idEmpresa)
                  .map((r) => r.RolCodigo)
              ),
              permisos: uniqueSorted(
                empresaPermisos
                  .filter((p) => Number(p.IdEmpresa) === idEmpresa)
                  .map((p) => p.PermisoCodigo)
              ),
            };
          })
          .filter(Boolean)
          .filter((empresa) => {
            if (isGlobalAdmin) return true;
            return licenciasMap.has(Number(empresa.idEmpresa));
          })
          .sort((a, b) => {
            if (a.esPrincipal === b.esPrincipal) {
              return a.nombre.localeCompare(b.nombre);
            }

            return a.esPrincipal ? -1 : 1;
          });
   
    const empresaPrincipal =
      empresas.find((e) => e.esPrincipal) || empresas[0] || null;

    let landingPage = "/paises";

    if (!isGlobalAdmin && empresas.length === 1) {
      landingPage = `/empresas/${empresas[0].idEmpresa}/dashboard`;
    }

    console.log("usuarioEmpresas:", usuarioEmpresas);
    console.log("empresaIds:", empresaIds);
    console.log("empresasCatalogo:", empresasCatalogo);
    console.log("paisesCatalogo:", paisesCatalogo);
    console.log("empresas armadas:", empresas);

    return res.json({
      ok: true,
      data: {
        user: {
          id: Number(user.id),
          usuario: user.Usuario,
          nombreCompleto: user.NombreCompleto || user.Usuario,
          correo: user.Correo || null,
          estado: Number(user.Estado),
        },
        rolesGlobales,
        permisosGlobales,
        isGlobalAdmin,
        empresaActivaSugerida: empresaPrincipal
          ? {
              idEmpresa: empresaPrincipal.idEmpresa,
              nombre: empresaPrincipal.nombre,
            }
          : null,
        empresas,
        landingPage,
      },
    });
  } catch (error) {
    console.error("GET /api/auth/me error:", error);

    return res.status(500).json({
      ok: false,
      message: "Error interno al obtener sesión",
    });
  }
});

export default router;
