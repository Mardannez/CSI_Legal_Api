import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { authorizeEmpresaAccess } from "../middlewares/authorizeEmpresaAcces.middleware.js";

const router = Router();
const TABLA_AUDITORIA_REQUISITO = "AuditoriaRequisito";
const TABLA_AUDITORIA_ESTADOS_REQUISITO = "AuditoriaEstadosRequisito";
const TABLA_AUDITORIA_EVIDENCIAS = "AuditoriaEvidencias";
const TABLA_AUDITORIA_EVENTOS = "AuditoriaEventos";
const TABLA_AUDITORIA_RESPONSABLES = "AuditoriaResponsables";

function toInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function normalizeText(value) {
  const text = (value || "").toString().trim();
  return text || null;
}

function normalizeDateOnly(value) {
  if (!value) return null;

  const raw = value.toString().trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function applyNullableFilter(query, column, value) {
  if (value === null || value === undefined || value === "") {
    return query.is(column, null);
  }

  return query.eq(column, value);
}

function getPeriocidadNombre(row) {
  if (!row) return null;

  return (
    row.Periocidad ||
    row.Nombre ||
    row.Descripcion ||
    row.NombrePeriocidad ||
    null
  );
}

function getUsuarioNombre(row) {
  if (!row) return "Usuario no disponible";

  return (
    row.NombreCompleto ||
    row.Usuario ||
    row.Correo ||
    `Usuario #${row.id}`
  );
}

function getEstadoNombre(row) {
  if (!row) return "No definido";

  return row.Estado || row.Nombre || row.Descripcion || `Estado #${row.id}`;
}

async function resolveCompanyIdByDetalleId(detalleId) {
  const { data: detalle, error: detalleError } = await supabase
    .from("EvaluacionDetalle")
    .select('id, "IdEvaluacionEncabezado"')
    .eq("id", detalleId)
    .maybeSingle();

  if (detalleError) throw detalleError;
  if (!detalle) return null;

  const { data: evaluacion, error: evaluacionError } = await supabase
    .from("EvaluacionEncabezado")
    .select('id, "IdEmpresa"')
    .eq("id", detalle.IdEvaluacionEncabezado)
    .maybeSingle();

  if (evaluacionError) throw evaluacionError;

  return Number(evaluacion?.IdEmpresa) || null;
}

async function resolveCompanyIdByEvidenceId(evidenceId) {
  const { data: evidence, error: evidenceError } = await supabase
    .from("Evidencias")
    .select("id, IdEvaluacionDetalle")
    .eq("id", evidenceId)
    .maybeSingle();

  if (evidenceError) throw evidenceError;
  if (!evidence) return null;

  return resolveCompanyIdByDetalleId(Number(evidence.IdEvaluacionDetalle));
}

async function resolveCompanyIdByEventoId(eventoId) {
  const { data: evento, error: eventoError } = await supabase
    .from("Eventos")
    .select("id, IdEvaluacionDetalle")
    .eq("id", eventoId)
    .maybeSingle();

  if (eventoError) throw eventoError;
  if (!evento) return null;

  return resolveCompanyIdByDetalleId(Number(evento.IdEvaluacionDetalle));
}

async function resolveCompanyIdByResponsableRequisitoId(responsableRequisitoId) {
  const { data: relacion, error: relacionError } = await supabase
    .from("RequisitoResponsables")
    .select("id, IdEvaluacionDetalle")
    .eq("id", responsableRequisitoId)
    .maybeSingle();

  if (relacionError) throw relacionError;
  if (!relacion) return null;

  return resolveCompanyIdByDetalleId(Number(relacion.IdEvaluacionDetalle));
}

async function buildAuditoriaRequisitoListado(auditorias = []) {
  const usuarioIds = [
    ...new Set(
      auditorias
        .map((row) => Number(row.IdUsuario))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  const periocidadIds = [
    ...new Set(
      auditorias
        .map((row) => Number(row.IdPeriocidad))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  let usuariosMap = new Map();
  let periocidadMap = new Map();

  if (usuarioIds.length > 0) {
    const { data: usuarios, error: usuariosError } = await supabase
      .from("Usuarios")
      .select('id, "Usuario", "NombreCompleto", "Correo"')
      .in("id", usuarioIds);

    if (usuariosError) {
      const error = new Error("Error consultando usuarios de auditoria");
      error.detail = usuariosError.message;
      throw error;
    }

    usuariosMap = new Map((usuarios || []).map((usuario) => [Number(usuario.id), usuario]));
  }

  if (periocidadIds.length > 0) {
    const { data: periocidades, error: periocidadesError } = await supabase
      .from("Periocidad")
      .select("*")
      .in("id", periocidadIds);

    if (periocidadesError) {
      const error = new Error("Error consultando periodicidad de auditoria");
      error.detail = periocidadesError.message;
      throw error;
    }

    periocidadMap = new Map(
      (periocidades || []).map((periocidad) => [Number(periocidad.id), periocidad])
    );
  }

  return auditorias.map((auditoria) => {
    const usuario = usuariosMap.get(Number(auditoria.IdUsuario)) || null;
    const periocidad = periocidadMap.get(Number(auditoria.IdPeriocidad)) || null;
    const usuarioNombre = getUsuarioNombre(usuario);
    const periodicidadNombre = getPeriocidadNombre(periocidad) || "No definido";
    const responsable = auditoria.Responsable || "No definido";
    const fechaPlanificada = auditoria.FechaPlanificada || null;

    return {
      id: auditoria.id,
      tipo: "EDICION_REQUISITO",
      titulo: "Edicion de Requisito",
      fechaRegistro: auditoria.FechaRegistro || null,
      usuarioRegistro: usuarioNombre,
      descripcion: `Responsable: ${responsable}. Fecha Planificada: ${
        fechaPlanificada || "No definida"
      }. Periodicidad: ${periodicidadNombre}.`,
      detalle: {
        responsable,
        fechaPlanificada,
        idPeriocidad: auditoria.IdPeriocidad ? Number(auditoria.IdPeriocidad) : null,
        periodicidad: periodicidadNombre,
      },
      usuario: {
        id: auditoria.IdUsuario ? Number(auditoria.IdUsuario) : null,
        usuario: usuario?.Usuario || null,
        nombreCompleto: usuario?.NombreCompleto || null,
        correo: usuario?.Correo || null,
      },
      raw: auditoria,
    };
  });
}

async function buildAuditoriaRequisitoRawResponse(auditorias = []) {
  const usuarioIds = [
    ...new Set(
      auditorias
        .map((row) => Number(row.IdUsuario))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  let usuariosMap = new Map();

  if (usuarioIds.length > 0) {
    const { data: usuarios, error: usuariosError } = await supabase
      .from("Usuarios")
      .select('id, "Usuario"')
      .in("id", usuarioIds);

    if (usuariosError) {
      const error = new Error("Error consultando usuarios de auditoria");
      error.detail = usuariosError.message;
      throw error;
    }

    usuariosMap = new Map((usuarios || []).map((usuario) => [Number(usuario.id), usuario]));
  }

  return auditorias.map((auditoria) => {
    const usuario = usuariosMap.get(Number(auditoria.IdUsuario)) || null;

    return {
      id: auditoria.id,
      IdEvaluacionDetalle: auditoria.IdEvaluacionDetalle,
      FechaRegistro: auditoria.FechaRegistro,
      Usuario: usuario?.Usuario || null,
      Responsable: auditoria.Responsable,
      FechaPlanificada: auditoria.FechaPlanificada,
      IdPeriocidad: auditoria.IdPeriocidad,
    };
  });
}

async function buildAuditoriaEstadosListado(auditorias = []) {
  const usuarioIds = [
    ...new Set(
      auditorias
        .map((row) => Number(row.IdUsuario))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  const estadoIds = [
    ...new Set(
      auditorias
        .map((row) => Number(row.IdEstadoNuevo))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  let usuariosMap = new Map();
  let estadosMap = new Map();

  if (usuarioIds.length > 0) {
    const { data: usuarios, error: usuariosError } = await supabase
      .from("Usuarios")
      .select('id, "Usuario", "NombreCompleto", "Correo"')
      .in("id", usuarioIds);

    if (usuariosError) {
      const error = new Error("Error consultando usuarios de auditoria de estados");
      error.detail = usuariosError.message;
      throw error;
    }

    usuariosMap = new Map((usuarios || []).map((usuario) => [Number(usuario.id), usuario]));
  }

  if (estadoIds.length > 0) {
    const { data: estados, error: estadosError } = await supabase
      .from("EstadoRequisito")
      .select('id, "Estado"')
      .in("id", estadoIds);

    if (estadosError) {
      const error = new Error("Error consultando estados de auditoria");
      error.detail = estadosError.message;
      throw error;
    }

    estadosMap = new Map((estados || []).map((estado) => [Number(estado.id), estado]));
  }

  return auditorias.map((auditoria) => {
    const usuario = usuariosMap.get(Number(auditoria.IdUsuario)) || null;
    const estadoNuevo = estadosMap.get(Number(auditoria.IdEstadoNuevo)) || null;
    const usuarioNombre = getUsuarioNombre(usuario);
    const estadoNuevoNombre = getEstadoNombre(estadoNuevo);

    return {
      id: auditoria.id,
      tipo: "CAMBIO_ESTADO_REQUISITO",
      titulo: "Actualizacion de estado",
      fechaRegistro: auditoria.FechaRegistro || null,
      usuarioRegistro: usuarioNombre,
      descripcion:
        auditoria.Descripcion ||
        `Se modifico requisito a estado ${estadoNuevoNombre}.`,
      detalle: {
        idEstadoNuevo: auditoria.IdEstadoNuevo ? Number(auditoria.IdEstadoNuevo) : null,
        estadoNuevo: estadoNuevoNombre,
      },
      usuario: {
        id: auditoria.IdUsuario ? Number(auditoria.IdUsuario) : null,
        usuario: usuario?.Usuario || null,
        nombreCompleto: usuario?.NombreCompleto || null,
        correo: usuario?.Correo || null,
      },
      raw: {
        id: auditoria.id,
        IdEvaluacionDetalle: auditoria.IdEvaluacionDetalle,
        FechaRegistro: auditoria.FechaRegistro,
        Usuario: usuario?.Usuario || null,
        IdEstadoNuevo: auditoria.IdEstadoNuevo,
        EstadoNuevo: estadoNuevoNombre,
        Descripcion: auditoria.Descripcion,
      },
    };
  });
}

async function buildAuditoriaEvidenciasListado(auditorias = []) {
  const usuarioIds = [
    ...new Set(
      auditorias
        .map((row) => Number(row.IdUsuario))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  const evidenciaIds = [
    ...new Set(
      auditorias
        .map((row) => Number(row.IdEvidencia))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  let usuariosMap = new Map();
  let evidenciasMap = new Map();

  if (usuarioIds.length > 0) {
    const { data: usuarios, error: usuariosError } = await supabase
      .from("Usuarios")
      .select('id, "Usuario", "NombreCompleto", "Correo"')
      .in("id", usuarioIds);

    if (usuariosError) {
      const error = new Error("Error consultando usuarios de auditoria de evidencias");
      error.detail = usuariosError.message;
      throw error;
    }

    usuariosMap = new Map((usuarios || []).map((usuario) => [Number(usuario.id), usuario]));
  }

  if (evidenciaIds.length > 0) {
    const { data: evidencias, error: evidenciasError } = await supabase
      .from("Evidencias")
      .select("id, IdEvaluacionDetalle, Nombre, Descripcion, FechaRegistro, NombreArchivoOriginal")
      .in("id", evidenciaIds);

    if (evidenciasError) {
      const error = new Error("Error consultando evidencias de auditoria");
      error.detail = evidenciasError.message;
      throw error;
    }

    evidenciasMap = new Map(
      (evidencias || []).map((evidencia) => [Number(evidencia.id), evidencia])
    );
  }

  return auditorias.map((auditoria) => {
    const usuario = usuariosMap.get(Number(auditoria.IdUsuario)) || null;
    const evidencia = evidenciasMap.get(Number(auditoria.IdEvidencia)) || null;
    const usuarioNombre = usuario?.Usuario || getUsuarioNombre(usuario);
    const nombreEvidencia = evidencia?.Nombre || `Evidencia #${auditoria.IdEvidencia}`;

    return {
      id: auditoria.id,
      tipo: (auditoria.DescripcionEvidencia || "").startsWith("Se elimino evidencia:")
        ? "ELIMINACION_EVIDENCIA"
        : "NUEVA_EVIDENCIA",
      titulo: (auditoria.DescripcionEvidencia || "").startsWith("Se elimino evidencia:")
        ? "Eliminacion de evidencia"
        : "Nueva Evidencia",
      fechaRegistro: auditoria.FechaRegistro || null,
      usuarioRegistro: usuarioNombre,
      descripcion:
        auditoria.DescripcionEvidencia ||
        `Se agrego evidencia: ${nombreEvidencia}.`,
      detalle: {
        idEvidencia: auditoria.IdEvidencia ? Number(auditoria.IdEvidencia) : null,
        nombreEvidencia,
        descripcionEvidencia: auditoria.DescripcionEvidencia || null,
        fechaEvidencia: auditoria.FechaEvidencia || null,
      },
      usuario: {
        id: auditoria.IdUsuario ? Number(auditoria.IdUsuario) : null,
        usuario: usuario?.Usuario || null,
        nombreCompleto: usuario?.NombreCompleto || null,
        correo: usuario?.Correo || null,
      },
      raw: {
        id: auditoria.id,
        IdEvidencia: auditoria.IdEvidencia,
        IdEvaluacionDetalle: auditoria.IdEvaluacionDetalle,
        FechaRegistro: auditoria.FechaRegistro,
        Usuario: usuario?.Usuario || null,
        DescripcionEvidencia: auditoria.DescripcionEvidencia,
        FechaEvidencia: auditoria.FechaEvidencia,
        Evidencia: {
          id: evidencia?.id || null,
          IdEvaluacionDetalle: evidencia?.IdEvaluacionDetalle || null,
          Nombre: evidencia?.Nombre || null,
          NombreArchivoOriginal: evidencia?.NombreArchivoOriginal || null,
        },
      },
    };
  });
}

async function buildAuditoriaEventosListado(auditorias = []) {
  const usuarioIds = [
    ...new Set(
      auditorias
        .map((row) => Number(row.IdUsuario))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  const eventoIds = [
    ...new Set(
      auditorias
        .map((row) => Number(row.IdEvento))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  let usuariosMap = new Map();
  let eventosMap = new Map();

  if (usuarioIds.length > 0) {
    const { data: usuarios, error: usuariosError } = await supabase
      .from("Usuarios")
      .select('id, "Usuario", "NombreCompleto", "Correo"')
      .in("id", usuarioIds);

    if (usuariosError) {
      const error = new Error("Error consultando usuarios de auditoria de eventos");
      error.detail = usuariosError.message;
      throw error;
    }

    usuariosMap = new Map((usuarios || []).map((usuario) => [Number(usuario.id), usuario]));
  }

  if (eventoIds.length > 0) {
    const { data: eventos, error: eventosError } = await supabase
      .from("Eventos")
      .select("id, IdEvaluacionDetalle, FechaRegistro, IdEvidencia, Comentario")
      .in("id", eventoIds);

    if (eventosError) {
      const error = new Error("Error consultando eventos de auditoria");
      error.detail = eventosError.message;
      throw error;
    }

    eventosMap = new Map((eventos || []).map((evento) => [Number(evento.id), evento]));
  }

  return auditorias.map((auditoria) => {
    const usuario = usuariosMap.get(Number(auditoria.IdUsuario)) || null;
    const evento = eventosMap.get(Number(auditoria.IdEvento)) || null;
    const usuarioNombre = usuario?.Usuario || getUsuarioNombre(usuario);
    const observacion = auditoria.Observacion || `Se agrego evento #${auditoria.IdEvento}.`;

    return {
      id: auditoria.id,
      tipo: observacion.startsWith("Se elimino evento:")
        ? "ELIMINACION_EVENTO"
        : "NUEVO_EVENTO",
      titulo: observacion.startsWith("Se elimino evento:")
        ? "Eliminacion de evento"
        : "Nuevo Evento",
      fechaRegistro: auditoria.FechaRegistro || null,
      usuarioRegistro: usuarioNombre,
      descripcion: observacion,
      detalle: {
        idEvento: auditoria.IdEvento ? Number(auditoria.IdEvento) : null,
        idEvaluacionDetalle: auditoria.IdEvaluacionDetalle
          ? Number(auditoria.IdEvaluacionDetalle)
          : null,
        observacion,
        fechaEvento: auditoria.FechaEvento || null,
      },
      usuario: {
        id: auditoria.IdUsuario ? Number(auditoria.IdUsuario) : null,
        usuario: usuario?.Usuario || null,
        nombreCompleto: usuario?.NombreCompleto || null,
        correo: usuario?.Correo || null,
      },
      raw: {
        id: auditoria.id,
        IdEvento: auditoria.IdEvento,
        FechaRegistro: auditoria.FechaRegistro,
        Usuario: usuario?.Usuario || null,
        Observacion: auditoria.Observacion,
        IdEvaluacionDetalle: auditoria.IdEvaluacionDetalle,
        FechaEvento: auditoria.FechaEvento,
        Evento: evento
          ? {
              id: evento.id,
              IdEvaluacionDetalle: evento.IdEvaluacionDetalle,
              FechaRegistro: evento.FechaRegistro,
              IdEvidencia: evento.IdEvidencia,
              Comentario: evento.Comentario,
            }
          : null,
      },
    };
  });
}

async function buildAuditoriaResponsablesListado(auditorias = []) {
  const usuarioIds = [
    ...new Set(
      auditorias
        .map((row) => Number(row.IdUsuario))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  const responsableRequisitoIds = [
    ...new Set(
      auditorias
        .map((row) => Number(row.IdResponsableRequisito))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  let usuariosMap = new Map();
  let relacionesMap = new Map();
  let responsablesMap = new Map();

  if (usuarioIds.length > 0) {
    const { data: usuarios, error: usuariosError } = await supabase
      .from("Usuarios")
      .select('id, "Usuario", "NombreCompleto", "Correo"')
      .in("id", usuarioIds);

    if (usuariosError) {
      const error = new Error("Error consultando usuarios de auditoria de responsables");
      error.detail = usuariosError.message;
      throw error;
    }

    usuariosMap = new Map((usuarios || []).map((usuario) => [Number(usuario.id), usuario]));
  }

  if (responsableRequisitoIds.length > 0) {
    const { data: relaciones, error: relacionesError } = await supabase
      .from("RequisitoResponsables")
      .select("id, IdEvaluacionDetalle, IdResponsable, FechaRegistro")
      .in("id", responsableRequisitoIds);

    if (relacionesError) {
      const error = new Error("Error consultando relaciones de responsables");
      error.detail = relacionesError.message;
      throw error;
    }

    relacionesMap = new Map((relaciones || []).map((relacion) => [Number(relacion.id), relacion]));

    const responsableIds = [
      ...new Set(
        (relaciones || [])
          .map((relacion) => Number(relacion.IdResponsable))
          .filter((id) => Number.isInteger(id) && id > 0)
      ),
    ];

    if (responsableIds.length > 0) {
      const { data: responsables, error: responsablesError } = await supabase
        .from("Responsables")
        .select("id, Nombre, Correo")
        .in("id", responsableIds);

      if (responsablesError) {
        const error = new Error("Error consultando responsables");
        error.detail = responsablesError.message;
        throw error;
      }

      responsablesMap = new Map(
        (responsables || []).map((responsable) => [Number(responsable.id), responsable])
      );
    }
  }

  return auditorias.map((auditoria) => {
    const usuario = usuariosMap.get(Number(auditoria.IdUsuario)) || null;
    const relacion = relacionesMap.get(Number(auditoria.IdResponsableRequisito)) || null;
    const responsable = relacion
      ? responsablesMap.get(Number(relacion.IdResponsable)) || null
      : null;
    const usuarioNombre = usuario?.Usuario || getUsuarioNombre(usuario);
    const observaciones = auditoria.Observaciones || "Registro de Responsable para el requisito.";

    return {
      id: auditoria.id,
      tipo: observaciones.startsWith("Eliminacion")
        ? "ELIMINACION_RESPONSABLE"
        : "REGISTRO_RESPONSABLE",
      titulo: observaciones.startsWith("Eliminacion")
        ? "Eliminacion de responsable"
        : "Registro de Responsable",
      fechaRegistro: auditoria.FechaRegistro || null,
      usuarioRegistro: usuarioNombre,
      descripcion: observaciones,
      detalle: {
        idResponsableRequisito: auditoria.IdResponsableRequisito
          ? Number(auditoria.IdResponsableRequisito)
          : null,
        idEvaluacionDetalle: auditoria.IdEvaluacionDetalle
          ? Number(auditoria.IdEvaluacionDetalle)
          : null,
        responsable: responsable?.Nombre || null,
        correo: responsable?.Correo || null,
        observaciones,
      },
      usuario: {
        id: auditoria.IdUsuario ? Number(auditoria.IdUsuario) : null,
        usuario: usuario?.Usuario || null,
        nombreCompleto: usuario?.NombreCompleto || null,
        correo: usuario?.Correo || null,
      },
      raw: {
        id: auditoria.id,
        IdResponsableRequisito: auditoria.IdResponsableRequisito,
        FechaRegistro: auditoria.FechaRegistro,
        Usuario: usuario?.Usuario || null,
        IdEvaluacionDetalle: auditoria.IdEvaluacionDetalle,
        Observaciones: auditoria.Observaciones,
        Responsable: responsable
          ? {
              id: responsable.id,
              Nombre: responsable.Nombre,
              Correo: responsable.Correo,
            }
          : null,
      },
    };
  });
}

export async function createAuditoriaRequisito({
  detalleId,
  idUsuario = null,
  responsable = null,
  fechaPlanificada = null,
  idPeriocidad = null,
  fechaRegistro = null,
} = {}) {
  const payload = {
    IdEvaluacionDetalle: Number(detalleId),
    FechaRegistro: normalizeDateOnly(fechaRegistro) || todayDateOnly(),
    IdUsuario: idUsuario ? Number(idUsuario) : null,
    Responsable: normalizeText(responsable),
    FechaPlanificada: normalizeDateOnly(fechaPlanificada),
    IdPeriocidad: idPeriocidad ? Number(idPeriocidad) : null,
  };

  let duplicateQuery = supabase
    .from(TABLA_AUDITORIA_REQUISITO)
    .select(
      'id, "IdEvaluacionDetalle", "FechaRegistro", "IdUsuario", "Responsable", "FechaPlanificada", "IdPeriocidad"'
    )
    .eq("IdEvaluacionDetalle", payload.IdEvaluacionDetalle)
    .eq("FechaRegistro", payload.FechaRegistro)
    .limit(1);

  duplicateQuery = applyNullableFilter(duplicateQuery, "IdUsuario", payload.IdUsuario);
  duplicateQuery = applyNullableFilter(duplicateQuery, "Responsable", payload.Responsable);
  duplicateQuery = applyNullableFilter(
    duplicateQuery,
    "FechaPlanificada",
    payload.FechaPlanificada
  );
  duplicateQuery = applyNullableFilter(duplicateQuery, "IdPeriocidad", payload.IdPeriocidad);

  const { data: duplicated, error: duplicatedError } = await duplicateQuery.maybeSingle();

  if (duplicatedError) {
    const auditError = new Error("Error validando auditoria duplicada");
    auditError.detail = duplicatedError.message;
    throw auditError;
  }

  if (duplicated) {
    return {
      ...duplicated,
      Duplicado: true,
    };
  }

  const { data, error } = await supabase
    .from(TABLA_AUDITORIA_REQUISITO)
    .insert(payload)
    .select(
      'id, "IdEvaluacionDetalle", "FechaRegistro", "IdUsuario", "Responsable", "FechaPlanificada", "IdPeriocidad"'
    )
    .single();

  if (error) {
    const auditError = new Error("Error registrando auditoria del requisito");
    auditError.detail = error.message;
    throw auditError;
  }

  return {
    ...data,
    Duplicado: false,
  };
}

export async function createAuditoriaEstadoRequisito({
  detalleId,
  idUsuario = null,
  idEstadoNuevo = null,
  estadoAnterior = null,
  estadoNuevo = null,
  descripcion = null,
  fechaRegistro = null,
} = {}) {
  const estadoNuevoId = idEstadoNuevo ? Number(idEstadoNuevo) : null;
  const fecha = normalizeDateOnly(fechaRegistro) || todayDateOnly();
  const descripcionFinal =
    normalizeText(descripcion) ||
    `Se modifico requisito de estado ${estadoAnterior || "No definido"} a estado ${
      estadoNuevo || "No definido"
    }.`;

  const payload = {
    IdEvaluacionDetalle: detalleId ? Number(detalleId) : null,
    IdUsuario: idUsuario ? Number(idUsuario) : null,
    FechaRegistro: fecha,
    IdEstadoNuevo: estadoNuevoId,
    Descripcion: descripcionFinal,
  };

  let duplicateQuery = supabase
    .from(TABLA_AUDITORIA_ESTADOS_REQUISITO)
    .select(
      'id, "IdEvaluacionDetalle", "IdUsuario", "FechaRegistro", "IdEstadoNuevo", "Descripcion"'
    )
    .eq("IdEvaluacionDetalle", payload.IdEvaluacionDetalle)
    .eq("FechaRegistro", payload.FechaRegistro)
    .eq("Descripcion", payload.Descripcion)
    .limit(1);

  duplicateQuery = applyNullableFilter(duplicateQuery, "IdUsuario", payload.IdUsuario);
  duplicateQuery = applyNullableFilter(duplicateQuery, "IdEstadoNuevo", payload.IdEstadoNuevo);

  const { data: duplicated, error: duplicatedError } = await duplicateQuery.maybeSingle();

  if (duplicatedError) {
    const auditError = new Error("Error validando auditoria de estado duplicada");
    auditError.detail = duplicatedError.message;
    throw auditError;
  }

  if (duplicated) {
    return {
      ...duplicated,
      Duplicado: true,
    };
  }

  const { data, error } = await supabase
    .from(TABLA_AUDITORIA_ESTADOS_REQUISITO)
    .insert(payload)
    .select(
      'id, "IdEvaluacionDetalle", "IdUsuario", "FechaRegistro", "IdEstadoNuevo", "Descripcion"'
    )
    .single();

  if (error) {
    const auditError = new Error("Error registrando auditoria de estado del requisito");
    auditError.detail = error.message;
    throw auditError;
  }

  return {
    ...data,
    Duplicado: false,
  };
}

export async function createAuditoriaEvidencia({
  idEvidencia,
  detalleId = null,
  idUsuario = null,
  descripcionEvidencia = null,
  fechaEvidencia = null,
  fechaRegistro = null,
} = {}) {
  const evidenciaId = idEvidencia ? Number(idEvidencia) : null;
  const payload = {
    IdEvidencia: evidenciaId,
    FechaRegistro: normalizeDateOnly(fechaRegistro) || todayDateOnly(),
    IdUsuario: idUsuario ? Number(idUsuario) : null,
    DescripcionEvidencia: normalizeText(descripcionEvidencia),
    FechaEvidencia: normalizeDateOnly(fechaEvidencia),
    IdEvaluacionDetalle: detalleId ? Number(detalleId) : null,
  };

  let duplicateQuery = supabase
    .from(TABLA_AUDITORIA_EVIDENCIAS)
    .select(
      'id, "IdEvidencia", "FechaRegistro", "IdUsuario", "DescripcionEvidencia", "FechaEvidencia", "IdEvaluacionDetalle"'
    )
    .eq("IdEvidencia", payload.IdEvidencia)
    .eq("FechaRegistro", payload.FechaRegistro)
    .limit(1);

  duplicateQuery = applyNullableFilter(duplicateQuery, "IdUsuario", payload.IdUsuario);
  duplicateQuery = applyNullableFilter(
    duplicateQuery,
    "DescripcionEvidencia",
    payload.DescripcionEvidencia
  );
  duplicateQuery = applyNullableFilter(duplicateQuery, "FechaEvidencia", payload.FechaEvidencia);
  duplicateQuery = applyNullableFilter(
    duplicateQuery,
    "IdEvaluacionDetalle",
    payload.IdEvaluacionDetalle
  );

  const { data: duplicated, error: duplicatedError } = await duplicateQuery.maybeSingle();

  if (duplicatedError) {
    const auditError = new Error("Error validando auditoria de evidencia duplicada");
    auditError.detail = duplicatedError.message;
    throw auditError;
  }

  if (duplicated) {
    return {
      ...duplicated,
      Duplicado: true,
    };
  }

  const { data, error } = await supabase
    .from(TABLA_AUDITORIA_EVIDENCIAS)
    .insert(payload)
    .select(
      'id, "IdEvidencia", "FechaRegistro", "IdUsuario", "DescripcionEvidencia", "FechaEvidencia", "IdEvaluacionDetalle"'
    )
    .single();

  if (error) {
    const auditError = new Error("Error registrando auditoria de evidencia");
    auditError.detail = error.message;
    throw auditError;
  }

  return {
    ...data,
    Duplicado: false,
  };
}

export async function createAuditoriaEvento({
  idEvento,
  detalleId = null,
  idUsuario = null,
  observacion = null,
  fechaEvento = null,
  fechaRegistro = null,
} = {}) {
  const payload = {
    IdEvento: idEvento ? Number(idEvento) : null,
    FechaRegistro: normalizeDateOnly(fechaRegistro) || todayDateOnly(),
    IdUsuario: idUsuario ? Number(idUsuario) : null,
    Observacion: normalizeText(observacion),
    IdEvaluacionDetalle: detalleId ? Number(detalleId) : null,
    FechaEvento: normalizeDateOnly(fechaEvento),
  };

  let duplicateQuery = supabase
    .from(TABLA_AUDITORIA_EVENTOS)
    .select(
      'id, "IdEvento", "FechaRegistro", "IdUsuario", "Observacion", "IdEvaluacionDetalle", "FechaEvento"'
    )
    .eq("IdEvento", payload.IdEvento)
    .eq("FechaRegistro", payload.FechaRegistro)
    .limit(1);

  duplicateQuery = applyNullableFilter(duplicateQuery, "IdUsuario", payload.IdUsuario);
  duplicateQuery = applyNullableFilter(duplicateQuery, "Observacion", payload.Observacion);
  duplicateQuery = applyNullableFilter(
    duplicateQuery,
    "IdEvaluacionDetalle",
    payload.IdEvaluacionDetalle
  );
  duplicateQuery = applyNullableFilter(duplicateQuery, "FechaEvento", payload.FechaEvento);

  const { data: duplicated, error: duplicatedError } = await duplicateQuery.maybeSingle();

  if (duplicatedError) {
    const auditError = new Error("Error validando auditoria de evento duplicada");
    auditError.detail = duplicatedError.message;
    throw auditError;
  }

  if (duplicated) {
    return {
      ...duplicated,
      Duplicado: true,
    };
  }

  const { data, error } = await supabase
    .from(TABLA_AUDITORIA_EVENTOS)
    .insert(payload)
    .select(
      'id, "IdEvento", "FechaRegistro", "IdUsuario", "Observacion", "IdEvaluacionDetalle", "FechaEvento"'
    )
    .single();

  if (error) {
    const auditError = new Error("Error registrando auditoria de evento");
    auditError.detail = error.message;
    throw auditError;
  }

  return {
    ...data,
    Duplicado: false,
  };
}

export async function createAuditoriaResponsable({
  idResponsableRequisito,
  detalleId = null,
  idUsuario = null,
  observaciones = null,
  fechaRegistro = null,
} = {}) {
  const payload = {
    IdResponsableRequisito: idResponsableRequisito ? Number(idResponsableRequisito) : null,
    FechaRegistro: normalizeDateOnly(fechaRegistro) || todayDateOnly(),
    IdUsuario: idUsuario ? Number(idUsuario) : null,
    IdEvaluacionDetalle: detalleId ? Number(detalleId) : null,
    Observaciones: normalizeText(observaciones) || "Registro de Responsable para el requisito.",
  };

  let duplicateQuery = supabase
    .from(TABLA_AUDITORIA_RESPONSABLES)
    .select(
      'id, "IdResponsableRequisito", "FechaRegistro", "IdUsuario", "IdEvaluacionDetalle", "Observaciones"'
    )
    .eq("IdResponsableRequisito", payload.IdResponsableRequisito)
    .eq("FechaRegistro", payload.FechaRegistro)
    .eq("Observaciones", payload.Observaciones)
    .limit(1);

  duplicateQuery = applyNullableFilter(duplicateQuery, "IdUsuario", payload.IdUsuario);
  duplicateQuery = applyNullableFilter(
    duplicateQuery,
    "IdEvaluacionDetalle",
    payload.IdEvaluacionDetalle
  );

  const { data: duplicated, error: duplicatedError } = await duplicateQuery.maybeSingle();

  if (duplicatedError) {
    const auditError = new Error("Error validando auditoria de responsable duplicada");
    auditError.detail = duplicatedError.message;
    throw auditError;
  }

  if (duplicated) {
    return {
      ...duplicated,
      Duplicado: true,
    };
  }

  const { data, error } = await supabase
    .from(TABLA_AUDITORIA_RESPONSABLES)
    .insert(payload)
    .select(
      'id, "IdResponsableRequisito", "FechaRegistro", "IdUsuario", "IdEvaluacionDetalle", "Observaciones"'
    )
    .single();

  if (error) {
    const auditError = new Error("Error registrando auditoria de responsable");
    auditError.detail = error.message;
    throw auditError;
  }

  return {
    ...data,
    Duplicado: false,
  };
}

/**
 * @swagger
 * tags:
 *   - name: AuditoriaEvaluacion
 *     description: Auditoria de cambios en requisitos evaluados
 */

/**
 * @swagger
 * /api/Auditoriaevaluacion/requisito/{detalleId}:
 *   get:
 *     summary: Listar auditoria de un requisito evaluado
 *     tags: [AuditoriaEvaluacion]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Auditoria consultada
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  "/requisito/:detalleId",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_VER"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId invalido",
        });
      }

      const { data, error } = await supabase
        .from(TABLA_AUDITORIA_REQUISITO)
        .select(
          'id, "IdEvaluacionDetalle", "FechaRegistro", "IdUsuario", "Responsable", "FechaPlanificada", "IdPeriocidad"'
        )
        .eq("IdEvaluacionDetalle", detalleId)
        .order("id", { ascending: false });

      if (error) {
        return res.status(500).json({
          message: "Error consultando auditoria del requisito",
          detail: error.message,
        });
      }

      const historial = await buildAuditoriaRequisitoListado(data || []);
      const auditoriaRequisito = await buildAuditoriaRequisitoRawResponse(data || []);

      return res.json({
        HistorialAuditoria: historial,
        AuditoriaRequisito: auditoriaRequisito,
      });
    } catch (error) {
      console.error("GET /Auditoriaevaluacion/requisito/:detalleId error:", error);

      return res.status(500).json({
        message: "Error interno consultando auditoria",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/Auditoriaevaluacion/requisito:
 *   post:
 *     summary: Registrar auditoria de un requisito evaluado
 *     tags: [AuditoriaEvaluacion]
 *     security:
 *       - bearerAuth: []
 *     parameters: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               IdEvaluacionDetalle:
 *                 type: integer
 *                 example: 10
 *               FechaRegistro:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-12"
 *               Responsable:
 *                 type: string
 *                 example: Juan Perez
 *               FechaPlanificada:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-15"
 *               IdPeriocidad:
 *                 type: integer
 *                 example: 2
 *     responses:
 *       201:
 *         description: Auditoria registrada
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  "/requisito",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_EDITAR"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.body?.IdEvaluacionDetalle ?? req.body?.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  async (req, res) => {
    try {
      const detalleId = toInt(req.body?.IdEvaluacionDetalle ?? req.body?.detalleId);
      const idPeriocidad = toInt(req.body?.IdPeriocidad ?? req.body?.idPeriocidad);
      const fechaRegistro = normalizeDateOnly(
        req.body?.FechaRegistro ?? req.body?.fechaRegistro
      );
      const fechaPlanificada = normalizeDateOnly(
        req.body?.FechaPlanificada ?? req.body?.fechaPlanificada
      );
      const responsable = normalizeText(req.body?.Responsable ?? req.body?.responsable);

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "IdEvaluacionDetalle es requerido",
        });
      }

      const auditoria = await createAuditoriaRequisito({
        detalleId,
        idUsuario: req.user?.id,
        responsable,
        fechaPlanificada,
        idPeriocidad,
        fechaRegistro,
      });

      return res.status(auditoria.Duplicado ? 200 : 201).json({
        message: auditoria.Duplicado
          ? "Auditoria ya registrada previamente"
          : "Auditoria registrada correctamente",
        Auditoria: auditoria,
      });
    } catch (error) {
      console.error("POST /Auditoriaevaluacion/requisito error:", error);

      return res.status(500).json({
        message: error.message || "Error interno registrando auditoria",
        detail: error.detail || error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/Auditoriaevaluacion/estados-requisito/{detalleId}:
 *   get:
 *     summary: Listar auditoria de cambios de estado de un requisito evaluado
 *     tags: [AuditoriaEvaluacion]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Auditoria de estados consultada
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  "/estados-requisito/:detalleId",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_VER"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId invalido",
        });
      }

      const { data, error } = await supabase
        .from(TABLA_AUDITORIA_ESTADOS_REQUISITO)
        .select(
          'id, "IdEvaluacionDetalle", "IdUsuario", "FechaRegistro", "IdEstadoNuevo", "Descripcion"'
        )
        .eq("IdEvaluacionDetalle", detalleId)
        .order("id", { ascending: false });

      if (error) {
        return res.status(500).json({
          message: "Error consultando auditoria de estados del requisito",
          detail: error.message,
        });
      }

      const historial = await buildAuditoriaEstadosListado(data || []);

      return res.json({
        HistorialAuditoriaEstados: historial,
        AuditoriaEstadosRequisito: historial.map((item) => item.raw),
      });
    } catch (error) {
      console.error("GET /Auditoriaevaluacion/estados-requisito/:detalleId error:", error);

      return res.status(500).json({
        message: "Error interno consultando auditoria de estados",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/Auditoriaevaluacion/estados-requisito:
 *   post:
 *     summary: Registrar auditoria de cambio de estado de un requisito evaluado
 *     tags: [AuditoriaEvaluacion]
 *     security:
 *       - bearerAuth: []
 *     parameters: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               IdEvaluacionDetalle:
 *                 type: integer
 *                 example: 52
 *               IdEstadoNuevo:
 *                 type: integer
 *                 example: 2
 *               FechaRegistro:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-13"
 *               Descripcion:
 *                 type: string
 *                 example: Se modifico requisito de estado En tramite a estado Cumplido.
 *     responses:
 *       201:
 *         description: Auditoria de estado registrada
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  "/estados-requisito",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["REQUISITOS_ESTADO_EDITAR"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.body?.IdEvaluacionDetalle ?? req.body?.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  async (req, res) => {
    try {
      const detalleId = toInt(req.body?.IdEvaluacionDetalle ?? req.body?.detalleId);
      const idEstadoNuevo = toInt(req.body?.IdEstadoNuevo ?? req.body?.idEstadoNuevo);
      const fechaRegistro = normalizeDateOnly(
        req.body?.FechaRegistro ?? req.body?.fechaRegistro
      );
      const descripcion = normalizeText(req.body?.Descripcion ?? req.body?.descripcion);

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "IdEvaluacionDetalle es requerido",
        });
      }

      if (!idEstadoNuevo || idEstadoNuevo <= 0) {
        return res.status(400).json({
          message: "IdEstadoNuevo es requerido",
        });
      }

      const { data: estadoNuevo, error: estadoNuevoError } = await supabase
        .from("EstadoRequisito")
        .select('id, "Estado"')
        .eq("id", idEstadoNuevo)
        .maybeSingle();

      if (estadoNuevoError) {
        return res.status(500).json({
          message: "Error consultando EstadoRequisito",
          detail: estadoNuevoError.message,
        });
      }

      if (!estadoNuevo) {
        return res.status(404).json({
          message: "EstadoRequisito no existe",
        });
      }

      const auditoria = await createAuditoriaEstadoRequisito({
        detalleId,
        idUsuario: req.user?.id,
        idEstadoNuevo,
        estadoNuevo: estadoNuevo.Estado,
        descripcion,
        fechaRegistro,
      });

      return res.status(auditoria.Duplicado ? 200 : 201).json({
        message: auditoria.Duplicado
          ? "Auditoria de estado ya registrada previamente"
          : "Auditoria de estado registrada correctamente",
        AuditoriaEstado: auditoria,
      });
    } catch (error) {
      console.error("POST /Auditoriaevaluacion/estados-requisito error:", error);

      return res.status(500).json({
        message: error.message || "Error interno registrando auditoria de estado",
        detail: error.detail || error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/Auditoriaevaluacion/evidencias/{detalleId}:
 *   get:
 *     summary: Listar auditoria de evidencias de un requisito evaluado
 *     tags: [AuditoriaEvaluacion]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Auditoria de evidencias consultada
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  "/evidencias/:detalleId",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_VER"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId invalido",
        });
      }

      const { data, error } = await supabase
        .from(TABLA_AUDITORIA_EVIDENCIAS)
        .select(
          'id, "IdEvidencia", "FechaRegistro", "IdUsuario", "DescripcionEvidencia", "FechaEvidencia", "IdEvaluacionDetalle"'
        )
        .eq("IdEvaluacionDetalle", detalleId)
        .order("id", { ascending: false });

      if (error) {
        return res.status(500).json({
          message: "Error consultando auditoria de evidencias",
          detail: error.message,
        });
      }

      const historial = await buildAuditoriaEvidenciasListado(data || []);

      return res.json({
        HistorialAuditoriaEvidencias: historial,
        AuditoriaEvidencias: historial.map((item) => item.raw),
      });
    } catch (error) {
      console.error("GET /Auditoriaevaluacion/evidencias/:detalleId error:", error);

      return res.status(500).json({
        message: "Error interno consultando auditoria de evidencias",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/Auditoriaevaluacion/evidencias:
 *   post:
 *     summary: Registrar auditoria de evidencia
 *     tags: [AuditoriaEvaluacion]
 *     security:
 *       - bearerAuth: []
 *     parameters: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               IdEvidencia:
 *                 type: integer
 *                 example: 15
 *               FechaRegistro:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-13"
 *               DescripcionEvidencia:
 *                 type: string
 *                 example: Se agrego evidencia: Contrato firmado.
 *               FechaEvidencia:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-10"
 *     responses:
 *       201:
 *         description: Auditoria de evidencia registrada
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  "/evidencias",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_EDITAR"],
    resolveEmpresaId: async (req) => {
      const idEvidencia = toInt(req.body?.IdEvidencia ?? req.body?.idEvidencia);
      if (!idEvidencia || idEvidencia <= 0) return null;
      return resolveCompanyIdByEvidenceId(idEvidencia);
    },
  }),
  async (req, res) => {
    try {
      const idEvidencia = toInt(req.body?.IdEvidencia ?? req.body?.idEvidencia);
      const fechaRegistro = normalizeDateOnly(
        req.body?.FechaRegistro ?? req.body?.fechaRegistro
      );
      const descripcionEvidencia = normalizeText(
        req.body?.DescripcionEvidencia ?? req.body?.descripcionEvidencia
      );
      const fechaEvidencia = normalizeDateOnly(
        req.body?.FechaEvidencia ?? req.body?.fechaEvidencia
      );

      if (!idEvidencia || idEvidencia <= 0) {
        return res.status(400).json({
          message: "IdEvidencia es requerido",
        });
      }

      const { data: evidencia, error: evidenciaError } = await supabase
        .from("Evidencias")
        .select("id, IdEvaluacionDetalle, Nombre, Descripcion, FechaRegistro")
        .eq("id", idEvidencia)
        .maybeSingle();

      if (evidenciaError) {
        return res.status(500).json({
          message: "Error consultando evidencia",
          detail: evidenciaError.message,
        });
      }

      if (!evidencia) {
        return res.status(404).json({
          message: "Evidencia no encontrada",
        });
      }

      const descripcionFinal =
        descripcionEvidencia ||
        `Se agrego evidencia: ${evidencia.Nombre || `Evidencia #${idEvidencia}`}.`;

      const auditoria = await createAuditoriaEvidencia({
        idEvidencia,
        detalleId: evidencia.IdEvaluacionDetalle,
        idUsuario: req.user?.id,
        descripcionEvidencia: descripcionFinal,
        fechaEvidencia: fechaEvidencia || normalizeDateOnly(evidencia.FechaRegistro),
        fechaRegistro,
      });

      return res.status(auditoria.Duplicado ? 200 : 201).json({
        message: auditoria.Duplicado
          ? "Auditoria de evidencia ya registrada previamente"
          : "Auditoria de evidencia registrada correctamente",
        AuditoriaEvidencia: auditoria,
      });
    } catch (error) {
      console.error("POST /Auditoriaevaluacion/evidencias error:", error);

      return res.status(500).json({
        message: error.message || "Error interno registrando auditoria de evidencia",
        detail: error.detail || error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/Auditoriaevaluacion/eventos/{detalleId}:
 *   get:
 *     summary: Listar auditoria de eventos de un requisito evaluado
 *     tags: [AuditoriaEvaluacion]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Auditoria de eventos consultada
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  "/eventos/:detalleId",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_VER"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId invalido",
        });
      }

      const { data, error } = await supabase
        .from(TABLA_AUDITORIA_EVENTOS)
        .select(
          'id, "IdEvento", "FechaRegistro", "IdUsuario", "Observacion", "IdEvaluacionDetalle", "FechaEvento"'
        )
        .eq("IdEvaluacionDetalle", detalleId)
        .order("id", { ascending: false });

      if (error) {
        return res.status(500).json({
          message: "Error consultando auditoria de eventos",
          detail: error.message,
        });
      }

      const historial = await buildAuditoriaEventosListado(data || []);

      return res.json({
        HistorialAuditoriaEventos: historial,
        AuditoriaEventos: historial.map((item) => item.raw),
      });
    } catch (error) {
      console.error("GET /Auditoriaevaluacion/eventos/:detalleId error:", error);

      return res.status(500).json({
        message: "Error interno consultando auditoria de eventos",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/Auditoriaevaluacion/eventos:
 *   post:
 *     summary: Registrar auditoria de evento
 *     tags: [AuditoriaEvaluacion]
 *     security:
 *       - bearerAuth: []
 *     parameters: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               IdEvento:
 *                 type: integer
 *                 example: 8
 *               FechaRegistro:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-13"
 *               Observacion:
 *                 type: string
 *                 example: Se agrego evento.
 *               IdEvaluacionDetalle:
 *                 type: integer
 *                 example: 52
 *               FechaEvento:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-30"
 *     responses:
 *       201:
 *         description: Auditoria de evento registrada
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  "/eventos",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_EDITAR"],
    resolveEmpresaId: async (req) => {
      const idEvento = toInt(req.body?.IdEvento ?? req.body?.idEvento);
      const detalleId = toInt(req.body?.IdEvaluacionDetalle ?? req.body?.detalleId);

      if (detalleId && detalleId > 0) return resolveCompanyIdByDetalleId(detalleId);
      if (idEvento && idEvento > 0) return resolveCompanyIdByEventoId(idEvento);

      return null;
    },
  }),
  async (req, res) => {
    try {
      const idEvento = toInt(req.body?.IdEvento ?? req.body?.idEvento);
      const detalleIdBody = toInt(req.body?.IdEvaluacionDetalle ?? req.body?.detalleId);
      const fechaRegistro = normalizeDateOnly(
        req.body?.FechaRegistro ?? req.body?.fechaRegistro
      );
      const observacion = normalizeText(req.body?.Observacion ?? req.body?.observacion);
      const fechaEvento = normalizeDateOnly(req.body?.FechaEvento ?? req.body?.fechaEvento);

      if (!idEvento || idEvento <= 0) {
        return res.status(400).json({
          message: "IdEvento es requerido",
        });
      }

      const { data: evento, error: eventoError } = await supabase
        .from("Eventos")
        .select("id, IdEvaluacionDetalle, FechaRegistro, IdEvidencia, Comentario")
        .eq("id", idEvento)
        .maybeSingle();

      if (eventoError) {
        return res.status(500).json({
          message: "Error consultando evento",
          detail: eventoError.message,
        });
      }

      if (!evento) {
        return res.status(404).json({
          message: "Evento no encontrado",
        });
      }

      const detalleId = detalleIdBody || Number(evento.IdEvaluacionDetalle);
      const observacionFinal =
        observacion ||
        `Se agrego evento.${evento.Comentario ? ` ${evento.Comentario}` : ""}`;

      const auditoria = await createAuditoriaEvento({
        idEvento,
        detalleId,
        idUsuario: req.user?.id,
        observacion: observacionFinal,
        fechaEvento: fechaEvento || normalizeDateOnly(evento.FechaRegistro),
        fechaRegistro,
      });

      return res.status(auditoria.Duplicado ? 200 : 201).json({
        message: auditoria.Duplicado
          ? "Auditoria de evento ya registrada previamente"
          : "Auditoria de evento registrada correctamente",
        AuditoriaEvento: auditoria,
      });
    } catch (error) {
      console.error("POST /Auditoriaevaluacion/eventos error:", error);

      return res.status(500).json({
        message: error.message || "Error interno registrando auditoria de evento",
        detail: error.detail || error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/Auditoriaevaluacion/responsables/{detalleId}:
 *   get:
 *     summary: Listar auditoria de responsables de un requisito evaluado
 *     tags: [AuditoriaEvaluacion]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Auditoria de responsables consultada
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  "/responsables/:detalleId",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_VER"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId invalido",
        });
      }

      const { data, error } = await supabase
        .from(TABLA_AUDITORIA_RESPONSABLES)
        .select(
          'id, "IdResponsableRequisito", "FechaRegistro", "IdUsuario", "IdEvaluacionDetalle", "Observaciones"'
        )
        .eq("IdEvaluacionDetalle", detalleId)
        .order("id", { ascending: false });

      if (error) {
        return res.status(500).json({
          message: "Error consultando auditoria de responsables",
          detail: error.message,
        });
      }

      const historial = await buildAuditoriaResponsablesListado(data || []);

      return res.json({
        HistorialAuditoriaResponsables: historial,
        AuditoriaResponsables: historial.map((item) => item.raw),
      });
    } catch (error) {
      console.error("GET /Auditoriaevaluacion/responsables/:detalleId error:", error);

      return res.status(500).json({
        message: "Error interno consultando auditoria de responsables",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/Auditoriaevaluacion/responsables:
 *   post:
 *     summary: Registrar auditoria de responsable de requisito
 *     tags: [AuditoriaEvaluacion]
 *     security:
 *       - bearerAuth: []
 *     parameters: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               IdResponsableRequisito:
 *                 type: integer
 *                 example: 12
 *               FechaRegistro:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-13"
 *               IdEvaluacionDetalle:
 *                 type: integer
 *                 example: 52
 *               Observaciones:
 *                 type: string
 *                 example: Registro de Responsable para el requisito.
 *     responses:
 *       201:
 *         description: Auditoria de responsable registrada
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  "/responsables",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_EDITAR"],
    resolveEmpresaId: async (req) => {
      const idResponsableRequisito = toInt(
        req.body?.IdResponsableRequisito ?? req.body?.idResponsableRequisito
      );
      const detalleId = toInt(req.body?.IdEvaluacionDetalle ?? req.body?.detalleId);

      if (detalleId && detalleId > 0) return resolveCompanyIdByDetalleId(detalleId);
      if (idResponsableRequisito && idResponsableRequisito > 0) {
        return resolveCompanyIdByResponsableRequisitoId(idResponsableRequisito);
      }

      return null;
    },
  }),
  async (req, res) => {
    try {
      const idResponsableRequisito = toInt(
        req.body?.IdResponsableRequisito ?? req.body?.idResponsableRequisito
      );
      const detalleId = toInt(req.body?.IdEvaluacionDetalle ?? req.body?.detalleId);
      const fechaRegistro = normalizeDateOnly(
        req.body?.FechaRegistro ?? req.body?.fechaRegistro
      );
      const observaciones = normalizeText(req.body?.Observaciones ?? req.body?.observaciones);

      if (!idResponsableRequisito || idResponsableRequisito <= 0) {
        return res.status(400).json({
          message: "IdResponsableRequisito es requerido",
        });
      }

      const auditoria = await createAuditoriaResponsable({
        idResponsableRequisito,
        detalleId,
        idUsuario: req.user?.id,
        observaciones: observaciones || "Registro de Responsable para el requisito.",
        fechaRegistro,
      });

      return res.status(auditoria.Duplicado ? 200 : 201).json({
        message: auditoria.Duplicado
          ? "Auditoria de responsable ya registrada previamente"
          : "Auditoria de responsable registrada correctamente",
        AuditoriaResponsable: auditoria,
      });
    } catch (error) {
      console.error("POST /Auditoriaevaluacion/responsables error:", error);

      return res.status(500).json({
        message: error.message || "Error interno registrando auditoria de responsable",
        detail: error.detail || error.message,
      });
    }
  }
);

export default router;
