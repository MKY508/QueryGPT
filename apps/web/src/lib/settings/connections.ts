import type { ConfiguredConnection } from "@/lib/types/api";

export interface ConnectionFormData {
  name: string;
  driver: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  is_default: boolean;
}

export interface ConnectionTestResult {
  id: string;
  success: boolean;
  message: string;
}

export const CONNECTION_DRIVERS = [
  { value: "mysql", label: "MySQL", defaultPort: 3306 },
  { value: "postgresql", label: "PostgreSQL", defaultPort: 5432 },
  { value: "sqlite", label: "SQLite", defaultPort: 0 },
] as const;

export const defaultConnectionFormData: ConnectionFormData = {
  name: "",
  driver: "mysql",
  host: "localhost",
  port: 3306,
  database: "",
  username: "",
  password: "",
  is_default: false,
};

export function buildConnectionFormData(
  connection: ConfiguredConnection
): ConnectionFormData {
  return {
    name: connection.name,
    driver: connection.driver,
    host: connection.host,
    port: connection.port,
    database: connection.database_name || "",
    username: connection.username,
    password: "",
    is_default: connection.is_default,
  };
}

export function applyDriverDefaults(
  formData: ConnectionFormData,
  driver: string
): ConnectionFormData {
  const driverInfo = CONNECTION_DRIVERS.find((item) => item.value === driver);
  return {
    ...formData,
    driver,
    port: driverInfo?.defaultPort ?? 3306,
  };
}

export function buildConnectionExportName(name: string, now = new Date()): string {
  return `querygpt-config-${name}-${now.toISOString().split("T")[0]}.json`;
}
