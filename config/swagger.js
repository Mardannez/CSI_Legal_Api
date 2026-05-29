import swaggerJSDoc from 'swagger-jsdoc';

const PORT = process.env.PORT || 4000;
const API_PUBLIC_URL =
  process.env.NEXT_PUBLIC_API_URL  ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${PORT}`);

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'CSI Legal API',
      version: '1.0.0',
      description: 'Documentación oficial de endpoints para CSI Legal',
    },
    servers: [
      {
        url: API_PUBLIC_URL,
        description: 'Servidor API CSI Legal',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },

      responses: {
        Unauthorized: {
          description: 'Token no enviado, inválido o expirado',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ok: {
                    type: 'boolean',
                    example: false,
                  },
                  message: {
                    type: 'string',
                    example: 'Token no enviado o inválido',
                  },
                },
              },
            },
          },
        },

        Forbidden: {
          description: 'No autorizado para realizar esta acción',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ok: {
                    type: 'boolean',
                    example: false,
                  },
                  message: {
                    type: 'string',
                    example: 'No autorizado',
                  },
                },
              },
            },
          },
        },

        NotFound: {
          description: 'Recurso no encontrado',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: {
                    type: 'string',
                    example: 'Registro no encontrado',
                  },
                },
              },
            },
          },
        },

        InternalServerError: {
          description: 'Error interno del servidor',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  message: {
                    type: 'string',
                    example: 'Error interno',
                  },
                },
              },
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },

  apis: [
    './src/routes/*.js',
    './src/routes/**/*.js',
  ],
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

export default swaggerSpec;
