import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    ScanCommand,
    PutCommand,
    UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
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
        return {
            statusCode: 500,
            headers: JSON_HEADERS,
            body: JSON.stringify({ error: "TABLE_NAME is not configured" }),
        };
    }

    const method = event.requestContext.http.method;

    if (method === "OPTIONS") {
        return { statusCode: 200, headers: JSON_HEADERS, body: "" };
    }

    try {
        if (method === "GET") {
            const out = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
            return {
                statusCode: 200,
                headers: JSON_HEADERS,
                body: JSON.stringify(out.Items ?? []),
            };
        }

        if (method === "POST") {
            const rawBody = event.body ?? "";
            const bodyStr = event.isBase64Encoded
                ? Buffer.from(rawBody, "base64").toString("utf8")
                : rawBody;
            const payload = bodyStr ? JSON.parse(bodyStr) : {};

            const idFromBody =
                typeof payload?.id === "string" && payload.id.trim()
                    ? payload.id.trim()
                    : undefined;

            const rawTitle = payload?.titulo;
            const hasTitleField = typeof rawTitle === "string";
            const title =
                hasTitleField && rawTitle.trim()
                    ? (rawTitle as string).trim()
                    : undefined;

            const hasCompletedField = typeof payload?.completada === "boolean";
            const completedValue = hasCompletedField
                ? (payload.completada as boolean)
                : undefined;

            if (!idFromBody) {
                if (!title) {
                    return badRequest("Field 'titulo' (string) is required");
                }

                const newId = uuid();
                const completedFinal = completedValue ?? false;

                await ddb.send(
                    new PutCommand({
                        TableName: TABLE_NAME,
                        Item: { id: newId, titulo: title, completada: completedFinal },
                    }),
                );

                return {
                    statusCode: 200,
                    headers: JSON_HEADERS,
                    body: JSON.stringify({
                        id: newId,
                        titulo: title,
                        completada: completedFinal,
                    }),
                };
            }

            if (!hasTitleField && !hasCompletedField) {
                return badRequest(
                    "You must send at least one of 'titulo' or 'completada' to update a task",
                );
            }

            if (hasTitleField && !title) {
                return badRequest("Field 'titulo' (string) cannot be empty");
            }

            const updateExpressions: string[] = [];
            const expressionValues: Record<string, unknown> = {};

            if (title !== undefined) {
                updateExpressions.push("titulo = :t");
                expressionValues[":t"] = title;
            }

            if (hasCompletedField) {
                updateExpressions.push("completada = :c");
                expressionValues[":c"] = completedValue;
            }

            try {
                const result = await ddb.send(
                    new UpdateCommand({
                        TableName: TABLE_NAME,
                        Key: { id: idFromBody },
                        UpdateExpression: "SET " + updateExpressions.join(", "),
                        ExpressionAttributeValues: expressionValues,
                        ReturnValues: "ALL_NEW",
                    }),
                );

                return {
                    statusCode: 200,
                    headers: JSON_HEADERS,
                    body: JSON.stringify(
                        result.Attributes ?? {
                            id: idFromBody,
                            ...(title !== undefined && { titulo: title }),
                            ...(hasCompletedField && { completada: completedValue }),
                        },
                    ),
                };
            } catch (err: any) {
                if (err?.name === "ConditionalCheckFailedException") {
                    return {
                        statusCode: 404,
                        headers: JSON_HEADERS,
                        body: JSON.stringify({
                            error: "Task with the given id does not exist",
                        }),
                    };
                }
                throw err;
            }
        }

        return {
            statusCode: 405,
            headers: JSON_HEADERS,
            body: JSON.stringify({ error: "Method not allowed" }),
        };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unexpected error";
        return {
            statusCode: 400,
            headers: JSON_HEADERS,
            body: JSON.stringify({ error: msg }),
        };
    }

    function badRequest(message: string) {
        return {
            statusCode: 400,
            headers: JSON_HEADERS,
            body: JSON.stringify({ error: message }),
        };
    }
};
