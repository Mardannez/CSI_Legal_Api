import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

const loginSchema = z.object({
  usuario: z.string().min(3),
  password: z.string().min(4),
});

/* Ruta de Login al sistema */
router.post("/login", async (req, res) => {
  try {
    const body = loginSchema.parse(req.body);

    const { data: user, error } = await supabase
      .from("Usuarios")
      .select("id, Usuario, Password, Estado")
      .eq("Usuario", body.usuario)
      .single();

    if (error || !user) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    if (user.Estado !== 1) {
      return res.status(403).json({ message: "Usuario inactivo" });
    }

    const ok = await bcrypt.compare(body.password, user.Password);
    if (!ok) {
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const token = jwt.sign(
      { sub: user.id, usuario: user.Usuario },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "1h" }
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

router.get("/me", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const [
      userResult,
      globalRolesResult,
      globalPermsResult,
      isGlobalAdminResult,
      usuarioEmpresaResult,
      empresaRolesResult,
      empresaPermsResult,
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

      supabase
        .from("vw_UsuarioPermisosGlobales")
        .select("PermisoCodigo")
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

      supabase
        .from("vw_UsuarioPermisosEmpresa")
        .select("IdEmpresa, PermisoCodigo")
        .eq("IdUsuario", userId),
    ]);

    if (userResult.error) throw userResult.error;
    if (globalRolesResult.error) throw globalRolesResult.error;
    if (globalPermsResult.error) throw globalPermsResult.error;
    if (isGlobalAdminResult.error) throw isGlobalAdminResult.error;
    if (usuarioEmpresaResult.error) throw usuarioEmpresaResult.error;
    if (empresaRolesResult.error) throw empresaRolesResult.error;
    if (empresaPermsResult.error) throw empresaPermsResult.error;

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

    const permisosGlobales = uniqueSorted(
      (globalPermsResult.data || []).map((x) => x.PermisoCodigo)
    );

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
    const empresaPermisos = empresaPermsResult.data || [];

    const empresas = usuarioEmpresas
      .map((ue) => {
        const idEmpresa = Number(ue.IdEmpresa);
        const empresa = empresasMap.get(idEmpresa);

        if (!empresa) return null;

        const pais = paisesMap.get(Number(empresa.IdPais));

        return {
          idEmpresa,
          nombre: empresa.Nombre,
          idPais: empresa.IdPais ? Number(empresa.IdPais) : null,
          pais: pais?.Pais ?? null,
          esPrincipal: ue.EsPrincipal === true,
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