<div align="center">
  
  <img src="../images/logo.png" width="400" alt="QueryGPT">
  
  <br/>
  
  <p>
    <a href="README.md">English</a> •
    <a href="docs/README_CN.md">简体中文</a> •
    <a href="#">Español</a>
  </p>
  
  <br/>
  
  [![License](https://img.shields.io/badge/Licencia-MIT-yellow.svg?style=for-the-badge)](LICENSE)
  [![Python](https://img.shields.io/badge/Python-3.10+-blue.svg?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
  [![OpenInterpreter](https://img.shields.io/badge/OpenInterpreter-0.4.3-green.svg?style=for-the-badge)](https://github.com/OpenInterpreter/open-interpreter)
  [![Stars](https://img.shields.io/badge/Stars-MKY508/QueryGPT-yellow.svg?style=for-the-badge&color=yellow)](https://github.com/MKY508/QueryGPT/stargazers)
  
  <br/>
  
  <h3>Un agente inteligente de análisis de datos basado en OpenInterpreter</h3>
  <p><i>Conversa con tu base de datos en lenguaje natural</i></p>
  
</div>

## ✨ Ventajas Principales

**Piensa como un Analista de Datos**
- **Exploración Autónoma**: Examina proactivamente estructuras de tablas y datos de muestra al encontrar problemas
- **Validación Multi-ronda**: Verifica nuevamente cuando se encuentran anomalías para garantizar resultados precisos
- **Análisis Complejo**: No solo SQL, puede ejecutar Python para análisis estadístico y aprendizaje automático
- **Pensamiento Visible**: Visualización en tiempo real del proceso de razonamiento del Agente (Chain-of-Thought)

## 📸 Capturas de Pantalla del Sistema

<img src="../images/agent-thinking-en.png" width="100%" alt="Interfaz QueryGPT"/>

**Visualización en tiempo real del proceso de pensamiento de la IA, análisis complejo de datos a través de conversaciones en español.**

---

<img src="../images/data-visualization-en.png" width="100%" alt="Visualización de Datos"/>

**Generación automática de gráficos interactivos, insights de datos de un vistazo.**

---

<img src="../images/developer-view-en.png" width="100%" alt="Vista de Desarrollador"/>

**Ejecución de código completamente transparente, soporta SQL y Python como motores duales.**

## 🌟 Funcionalidades

### Capacidades Principales del Agente
- **Exploración Autónoma de Datos**: El Agente comprende proactivamente la estructura de datos y explora relaciones
- **Razonamiento Multi-ronda**: Como un analista, investiga profundamente cuando surgen problemas
- **Chain-of-Thought**: Visualización en tiempo real del proceso de pensamiento del Agente, intervención posible en cualquier momento
- **Memoria de Contexto**: Comprende el historial de conversaciones, soporta análisis continuo multi-ronda

### Capacidades de Análisis de Datos
- **SQL + Python**: No limitado a SQL, puede ejecutar procesamiento complejo de datos en Python
- **Análisis Estadístico**: Análisis automático de correlación, predicción de tendencias, detección de anomalías
- **Términos de Negocio**: Comprensión nativa de conceptos como YoY, MoM, retención, recompra
- **Visualización Inteligente**: Selecciona automáticamente el mejor tipo de gráfico basado en las características de los datos

### Características del Sistema
- **Soporte Multi-modelo**: Cambia libremente entre GPT-5, Claude, Gemini, modelos locales Ollama
- **Despliegue Flexible**: Soporta API en la nube o despliegue local Ollama, los datos nunca salen de las instalaciones
- **Registros de Historial**: Guarda el proceso de análisis, soporta seguimiento y compartición
- **Seguridad de Datos**: Permisos de solo lectura, protección contra inyección SQL, enmascaramiento de datos sensibles
- **Exportación Flexible**: Soporta formatos Excel, PDF, HTML y otros

## 📦 Requisitos Técnicos

- Python 3.10.x (requerido, dependencia de OpenInterpreter 0.4.3)
- MySQL o base de datos compatible

> Windows: Ejecuta en WSL (no ejecutes scripts en PowerShell/CMD).

## 📊 Comparación de Productos

| Dimensión de Comparación | **QueryGPT** | Vanna AI | DB-GPT | TableGPT | Text2SQL.AI |
|-------------------------|:------------:|:--------:|:------:|:--------:|:-----------:|
| **Costo** | **✅ Gratuito** | ⭕ Versión de pago | ✅ Gratuito | ❌ Pago | ❌ Pago |
| **Código Abierto** | **✅** | ✅ | ✅ | ❌ | ❌ |
| **Despliegue Local** | **✅** | ✅ | ✅ | ❌ | ❌ |
| **Ejecuta Código Python** | **✅ Entorno completo** | ❌ | ❌ | ❌ | ❌ |
| **Capacidad de Visualización** | **✅ Programable** | ⭕ Gráficos predefinidos | ✅ Gráficos ricos | ✅ Gráficos ricos | ⭕ Básico |
| **Comprensión de Términos de Negocio** | **✅ Nativo** | ⭕ Básico | ✅ Bueno | ✅ Excelente | ⭕ Básico |
| **Exploración Autónoma del Agente** | **✅** | ❌ | ⭕ Básico | ⭕ Básico | ❌ |
| **Visualización de Pensamiento en Tiempo Real** | **✅** | ❌ | ❌ | ❌ | ❌ |
| **Capacidad de Extensión** | **✅ Extensión ilimitada** | ❌ | ❌ | ❌ | ❌ |

### Nuestras Diferencias Principales
- **Entorno Python Completo**: No son funciones predefinidas, sino un entorno de ejecución Python real donde puedes escribir cualquier código
- **Extensibilidad Ilimitada**: ¿Necesitas nuevas funciones? Simplemente instala nuevas bibliotecas, no necesitas esperar actualizaciones del producto
- **Exploración Autónoma del Agente**: Investiga proactivamente cuando encuentra problemas, no es solo una consulta única simple
- **Proceso de Pensamiento Transparente**: Ve en tiempo real lo que la IA está pensando, puede intervenir y guiar en cualquier momento
- **Verdaderamente Gratuito y Open Source**: Licencia MIT, sin barreras de pago

## 🚀 Inicio Rápido

### Primer Uso

```bash
# 1. Clonar el proyecto
git clone https://github.com/MKY508/QueryGPT.git
cd QueryGPT

# 2. Ejecutar script de instalación (configura automáticamente el entorno)
./setup.sh

# 3. Iniciar el servicio
./start.sh
```

### Uso Posterior

```bash
# Inicio rápido directo (entorno ya instalado)
./start.sh
```

El servicio se ejecuta por defecto en http://localhost:5000

> **Nota**: Si el puerto 5000 está ocupado (por ejemplo, AirPlay en macOS), el sistema seleccionará automáticamente el siguiente puerto disponible (5001-5010) y mostrará el puerto real utilizado al iniciar.

## ⚙️ Instrucciones de Configuración

### Configuración Básica

1. **Copiar archivo de configuración de entorno**
   ```bash
   cp .env.example .env
   ```

2. **Editar el archivo .env para configurar lo siguiente**
   - `OPENAI_API_KEY`: Tu clave de API de OpenAI
   - `OPENAI_BASE_URL`: Endpoint de la API (opcional, por defecto usa el endpoint oficial)
   - Información de conexión a la base de datos

### Configuración de Capa Semántica (Opcional)

La capa semántica mejora la comprensión de términos de negocio, ayudando al sistema a entender mejor tu lenguaje de negocio. **Esta es una configuración opcional, no configurarla no afecta las funcionalidades básicas.**

1. **Copiar archivo de ejemplo**
   ```bash
   cp backend/semantic_layer.json.example backend/semantic_layer.json
   ```

2. **Modificar la configuración según tus necesidades de negocio**
   
   La configuración de la capa semántica contiene tres partes:
   - **Mapeo de Base de Datos**: Define el significado comercial de la base de datos
   - **Tablas de Negocio Principales**: Mapea tablas y campos de negocio importantes
   - **Índice de Búsqueda Rápida**: Búsqueda rápida de términos comunes

3. **Ejemplo de Configuración**
   ```json
   {
     "Tablas de Negocio Principales": {
       "Gestión de Pedidos": {
         "Ruta de Tabla": "database.orders",
         "Palabras Clave": ["pedido", "venta", "transacción"],
         "Campos Requeridos": {
           "order_id": "Número de Pedido",
           "amount": "Monto"
         }
       }
     }
   }
   ```

> **Nota**: 
> - El archivo de capa semántica contiene información comercial sensible y se ha agregado a `.gitignore`, no se enviará al control de versiones
> - Cuando la capa semántica no está configurada, el sistema usa la configuración predeterminada y aún puede realizar consultas de datos normalmente
> - Para instrucciones detalladas de configuración, consulta [backend/SEMANTIC_LAYER_SETUP.md](backend/SEMANTIC_LAYER_SETUP.md)

## 📁 Estructura del Proyecto

```
QueryGPT/
├── backend/              # Servicio backend
│   ├── app.py           # Entrada principal de la aplicación Flask
│   ├── database.py      # Gestión de conexión a base de datos
│   ├── interpreter_manager.py  # Intérprete de consultas
│   ├── history_manager.py      # Gestión de historial
│   └── config_loader.py        # Cargador de configuración
├── frontend/            # Interfaz frontend
│   ├── templates/       # Plantillas HTML
│   └── static/          # Recursos estáticos
│       ├── css/         # Archivos de estilo
│       └── js/          # JavaScript
├── docs/                # Documentación del proyecto
├── logs/                # Directorio de logs
├── output/              # Archivos de salida
├── requirements.txt     # Dependencias Python
└── .env.example         # Ejemplo de configuración
```

## 🔌 API

### Interfaz de Consulta

```http
POST /api/chat
Content-Type: application/json

{
  "message": "Consultar total de ventas de este mes",
  "model": "default"
}
```

### Historial

```http
GET /api/history/conversations    # Obtener lista de historial
GET /api/history/conversation/:id # Obtener detalles
DELETE /api/history/conversation/:id # Eliminar registro
```

### Verificación de Salud

```http
GET /api/health
```

## 🔒 Información de Seguridad

- Solo soporta consultas de solo lectura (SELECT, SHOW, DESCRIBE)
- Filtra automáticamente declaraciones SQL peligrosas
- Los usuarios de la base de datos deben configurarse con permisos de solo lectura

## 📄 Licencia

MIT License - Ver archivo [LICENSE](LICENSE) para detalles

## 🆕 Actualizaciones Recientes

- 2025-09-05 – Optimización de velocidad de inicio: Eliminada prueba automática en lote al entrar por primera vez a la página de modelos, reduciendo solicitudes innecesarias y evitando escritura incorrecta de estado.

## 👨‍💻 Autor

- **Autor**: Mao Kaiyue
- **GitHub**: [@MKY508](https://github.com/MKY508)
- **Fecha de Creación**: Agosto de 2025

## ⭐ Star History

<div align="center">
  <a href="https://star-history.com/#MKY508/QueryGPT&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date" />
    </picture>
  </a>
</div>

## 🤝 Contribución

Bienvenido para enviar Issues y Pull Requests.

1. Fork este proyecto
2. Crea una rama de funcionalidad (`git checkout -b feature/AmazingFeature`)
3. Confirma tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request
