import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuid } from "uuid";

const { TABLE_NAME } = process.env;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const JSON_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    if (!TABLE_NAME) {
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "TABLE_NAME no configurado" }) };
    }

    const method = event.requestContext.http.method;

    if (method === "OPTIONS") return { statusCode: 200, headers: JSON_HEADERS, body: "" };

    try {
        if (method === "GET") {
            const out = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
            return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(out.Items ?? []) };
        }

        if (method === "POST") {
            const raw = event.body ?? "";
            const bodyStr = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
            const payload = bodyStr ? JSON.parse(bodyStr) : {};

            const titulo = payload?.titulo;
            if (typeof titulo !== "string" || !titulo.trim()) {
                return bad("titulo (string) es requerido");
            }

            const id: string = typeof payload?.id === "string" && payload.id ? payload.id : uuid();
            const completada: boolean = typeof payload?.completada === "boolean" ? payload.completada : false;

            if (payload?.id) {
                const result = await ddb.send(new UpdateCommand({
                    TableName: TABLE_NAME,
                    Key: { id },
                    UpdateExpression: "SET titulo = :t, completada = :c",
                    ExpressionAttributeValues: { ":t": titulo, ":c": completada },
                    ReturnValues: "ALL_NEW",
                }));
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(result.Attributes ?? { id, titulo, completada }) };
            } else {
                await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: { id, titulo, completada } }));
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ id, titulo, completada }) };
            }
        }

        return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: "Método no permitido" }) };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Error";
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: msg }) };
    }

    function bad(msg: string) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: msg }) };
    }
};