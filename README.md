# Parte 2 — Tasks API (AWS Lambda + API Gateway + DynamoDB)

API serverless para gestionar tareas (**tasks**) con:
- **GET /tasks** → lista todas las tareas.
- **POST /tasks** → crea o actualiza una tarea.
- Validación:
  - **Crear**: `titulo` (string no vacío) es **obligatorio**.
  - **Actualizar**: `id` es obligatorio y se debe enviar **al menos uno** de `titulo` o `completada`.
- Defaults:
  - Al crear, si no se envía `completada`, se asume `false`.
  - Al actualizar, cualquier campo que **no** se envíe mantiene su valor actual.
- Códigos: **200** éxito / **400** validación o errores controlados.

---

## Arquitectura

```text
Cliente (curl/Postman) ──HTTP──> API Gateway (HTTP API)
                                   │
                                   └──> AWS Lambda (Node.js 20, TypeScript)
                                           │
                                           └──> DynamoDB (tabla: tec-practicantes-tasks, PK: id String)
```

---

## Requisitos

- Cuenta AWS con acceso a **Lambda**, **API Gateway (HTTP API)**, **DynamoDB**, **IAM**.
- **Node.js 20+** y npm.
- Región de trabajo (ej. `us-east-1`) **coincidente** entre Lambda y DynamoDB.

---

## Estructura del proyecto

```text
  ├─ src/
  │   └─ handler.ts          # Lambda handler (GET/POST)
  ├─ dist/                   # build (generado)
  ├─ package.json
  ├─ tsconfig.json
  └─ bundle.zip              # artefacto para subir a Lambda (generado)
```

### Scripts (build y zip)

`package.json`:
```json
{
  "name": "tasks-api",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "esbuild src/handler.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist/handler.js",
    "zip": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Compress-Archive -Path dist\\* -DestinationPath bundle.zip -Force\""
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.130",
    "@types/node": "^20.11.30",
    "esbuild": "^0.24.0",
    "typescript": "^5.6.3"
  },
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.654.0",
    "@aws-sdk/lib-dynamodb": "^3.654.0",
    "uuid": "^9.0.1"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

**Compilar y empaquetar:**
```bash
npm install
npm run build
npm run zip   # genera bundle.zip en la raíz con handler.js en la raíz del ZIP
```

---

## Despliegue (Consola AWS)

### 1) DynamoDB — crear tabla
- **DynamoDB > Tables > Create table**
  - **Table name**: `tec-practicantes-tasks`
  - **Partition key**: `id` (String)
  - Billing: **On-demand**

### 2) IAM — rol para Lambda
- **IAM > Roles > Create role** (Use case: **Lambda**)
- Permisos:
  - **AWSLambdaBasicExecutionRole** (logs en CloudWatch)
  - **DynamoDBFullAccess** (o crear política personalizada con `Scan`, `PutItem`, `UpdateItem`, `DescribeTable` sobre la tabla)

### 3) Lambda — crear función y subir ZIP
- **Lambda > Create function**
  - *Desde Cero*, **Runtime: Node.js 20.x**
  - **Permissions**: usar el **rol** creado arriba
- En la función:
  - **Code > Upload from > .zip file** → subir `bundle.zip` → **Save**
  - **Runtime settings > Edit**
    - **Handler**: `handler.handler`
  - **Configuration > Environment variables > Edit**
    - `TABLE_NAME = tec-practicantes-tasks`
  - **General configuration > Edit**
    - Memory: **256 MB**, Timeout: **10 s**

### 4) Probar Lambda (sin API)
Crea eventos de prueba:

**GET /tasks**
```json
{
  "version": "2.0",
  "routeKey": "GET /tasks",
  "rawPath": "/tasks",
  "requestContext": { "http": { "method": "GET" } }
}
```

**POST /tasks (crear)**
```json
{
  "version": "2.0",
  "routeKey": "POST /tasks",
  "rawPath": "/tasks",
  "requestContext": { "http": { "method": "POST" } },
  "body": "{\"titulo\":\"comprar café\"}"
}
```

**POST /tasks (actualizar solo completada)**
```json
{
  "version": "2.0",
  "routeKey": "POST /tasks",
  "rawPath": "/tasks",
  "requestContext": { "http": { "method": "POST" } },
  "body": "{\"id\":\"<uuid-existente>\",\"completada\":true}"
}
```

**POST /tasks (actualizar solo titulo)**
```json
{
  "version": "2.0",
  "routeKey": "POST /tasks",
  "rawPath": "/tasks",
  "requestContext": { "http": { "method": "POST" } },
  "body": "{\"id\":\"<uuid-existente>\",\"titulo\":\"nuevo título\"}"
}
```

Deberías recibir **200** (éxito) o **400** (validación).  
Si aparece `AccessDeniedException`, revisa permisos del rol; si `TABLE_NAME is not configured`, revisa la variable de entorno.

### 5) API Gateway (HTTP API) — trigger y rutas
- En el **Lambda**, clic **Add trigger** → **API Gateway** → **Create an API** → **HTTP API** → **Add**
- Ir a **API Gateway > HTTP API > Routes**
  - **Create route** → Method: **GET**, Path: **/tasks** → Integration: Lambda
  - **Create route** → Method: **POST**, Path: **/tasks** → Integration: Lambda
- **CORS** (en HTTP API):
  - Allow origins: `*`
  - Allow methods: `GET, POST, OPTIONS`
  - Allow headers: `content-type`
- **Stages**:
  - Para URL **sin** sufijo, crea el stage especial **`$default`** con **Auto-deploy ON**  
    → URL base: `https://<api-id>.execute-api.<region>.amazonaws.com`

---

## Endpoints y ejemplos

**Base URL** (con stage `$default`):  
`https://<api-id>.execute-api.<region>.amazonaws.com`

### GET `/tasks`
**200 OK**
```json
[
  { "id": "uuid-1", "titulo": "comprar café", "completada": false }
]
```

### POST `/tasks`

- **Crear**: body
  ```json
  { "titulo": "comprar café" }
  ```
- **Actualizar solo completada**:
  ```json
  { "id": "uuid-1", "completada": true }
  ```
- **Actualizar solo titulo**:
  ```json
  { "id": "uuid-1", "titulo": "comprar leche" }
  ```
- **Actualizar ambos campos**:
  ```json
  { "id": "uuid-1", "titulo": "comprar leche", "completada": true }
  ```

**200 OK (crear)**
```json
{ "id": "uuid-generado", "titulo": "comprar café", "completada": false }
```

**400 Bad Request (ej. crear sin titulo)**
```json
{ "error": "Field 'titulo' (string) is required" }
```

**400 Bad Request (ej. actualizar sin campos editables)**
```json
{ "error": "You must send at least one of 'titulo' or 'completada' to update a task" }
```

---

## Esquema (DynamoDB)

Tabla: `tec-practicantes-tasks`  
PK: `id` (String)

Item:
```json
{ "id": "string", "titulo": "string", "completada": true }
```

---

## Códigos y headers

- **200**: éxito (listar / crear / actualizar)
- **400**: validación o error controlado
- Headers: `Content-Type: application/json` y CORS (`Access-Control-Allow-*`)
