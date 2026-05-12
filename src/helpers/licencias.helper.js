import { supabase } from "../lib/supabase.js";

// ==========================================================
// LICENCIAS DE EMPRESA
// Helper reutilizable para validar licencias activas por empresa.
// Una licencia se considera activa cuando:
// - Estado = ACTIVA
// - FechaInicio <= fecha actual
// - FechaFin >= fecha actual
// ==========================================================

function getTodayISODate() {
  return new Date().toISOString().slice(0, 10);
}

export async function getActiveEmpresaLicense(idEmpresa) {
  if (!idEmpresa) return null;

  const today = getTodayISODate();

  const { data, error } = await supabase
    .from("EmpresaLicencia")
    .select(`
      id,
      IdEmpresa,
      FechaInicio,
      FechaFin,
      Estado,
      TipoLicencia,
      MaxUsuarios
    `)
    .eq("IdEmpresa", Number(idEmpresa))
    .eq("Estado", "ACTIVA")
    .lte("FechaInicio", today)
    .gte("FechaFin", today)
    .order("FechaFin", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error validando licencia de empresa:", error);
    throw error;
  }

  return data || null;
}

export async function getActiveLicensesByEmpresaIds(empresaIds = []) {
  const ids = [
    ...new Set(
      empresaIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    ),
  ];

  if (ids.length === 0) return [];

  const today = getTodayISODate();

  const { data, error } = await supabase
    .from("EmpresaLicencia")
    .select(`
      id,
      IdEmpresa,
      FechaInicio,
      FechaFin,
      Estado,
      TipoLicencia,
      MaxUsuarios
    `)
    .in("IdEmpresa", ids)
    .eq("Estado", "ACTIVA")
    .lte("FechaInicio", today)
    .gte("FechaFin", today)
    .order("FechaFin", { ascending: false });

  if (error) {
    console.error("Error validando licencias por empresa:", error);
    throw error;
  }

  // Si una empresa tiene varias licencias activas, dejamos la más reciente por FechaFin.
  const map = new Map();

  for (const licencia of data || []) {
    const idEmpresa = Number(licencia.IdEmpresa);

    if (!map.has(idEmpresa)) {
      map.set(idEmpresa, licencia);
    }
  }

  return Array.from(map.values());
}

export function buildLicenseMap(licencias = []) {
  return new Map(
    licencias.map((licencia) => [Number(licencia.IdEmpresa), licencia])
  );
}