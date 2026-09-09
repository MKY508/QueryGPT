"use client";

import { useState, type FormEvent, type RefObject } from "react";
import {
  CONNECTION_DRIVERS,
  type ConnectionFormData,
} from "@/lib/settings/connections";
import { useTranslations } from "next-intl";
import { validateConnectionSettings } from "@/lib/settings/validation";
import { useSettingsValidation } from "@/components/settings/hooks/useSettingsValidation";
import { SettingsDisclosure, SettingsForm } from "../SettingsForm";
import styles from "../SettingsForm.module.css";

interface ConnectionSettingsFormProps {
  embedded?: boolean;
  formRef?: RefObject<HTMLFormElement | null>;
  editingId: string | null;
  formData: ConnectionFormData;
  isSubmitting: boolean;
  onChange: (next: ConnectionFormData) => void;
  onDriverChange: (driver: string) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function ConnectionSettingsForm({
  embedded = false,
  formRef,
  editingId,
  formData,
  isSubmitting,
  onChange,
  onDriverChange,
  onReset,
  onSubmit,
}: ConnectionSettingsFormProps) {
  const t = useTranslations("connectionSettings");
  const tc = useTranslations("common");
  const tv = useTranslations("settingsValidation");
  const errors = Object.fromEntries(Object.entries(validateConnectionSettings(formData)).map(([field, issue]) => [field, tv(issue)]));
  const validation = useSettingsValidation({ scope: editingId, errors, busy: isSubmitting });
  const hasAdvancedOptions =
    formData.extra_options.sslmode !== "prefer" ||
    Boolean(
      formData.extra_options.schema ||
        formData.extra_options.sslrootcert ||
        formData.extra_options.sslcert ||
        formData.extra_options.sslkey
    );
  const [advanced, setAdvanced] = useState({ editingId, hasOptions: hasAdvancedOptions, open: hasAdvancedOptions });
  if (advanced.editingId !== editingId || advanced.hasOptions !== hasAdvancedOptions) {
    setAdvanced({ editingId, hasOptions: hasAdvancedOptions, open: hasAdvancedOptions || advanced.open });
  }

  return (
    <SettingsForm
      embedded={embedded}
      formRef={formRef}
      title={editingId ? t("editConnection") : t("addConnection")}
      closeLabel={tc("close")}
      submitLabel={editingId ? t("update") : tc("save")}
      busy={isSubmitting}
      testId="connection"
      feedback={validation.summary}
      onCancel={onReset}
      onSubmit={event => validation.submit(event, onSubmit)}
    >
      <div className={styles.grid}>
        <div>
          <label htmlFor={validation.id("name")} className={styles.label}>{t("connectionName")}</label>
          <input {...validation.field("name")}
            type="text"
            value={formData.name}
            onChange={(event) => onChange({ ...formData, name: event.target.value })}
            data-testid="connection-name-input"
            data-settings-primary-field=""
            className={styles.control}
            placeholder={t("connectionNamePlaceholder")}
            required
          />
          {validation.error("name")}
        </div>
        <div>
          <label htmlFor={validation.id("driver")} className={styles.label}>{t("databaseType")}</label>
          <select {...validation.field("driver")}
            value={formData.driver}
            onChange={(event) => onDriverChange(event.target.value)}
            data-testid="connection-driver-select"
            className={styles.control}
          >
            {CONNECTION_DRIVERS.map((driver) => (
              <option key={driver.value} value={driver.value}>
                {driver.label}
              </option>
            ))}
          </select>
        </div>
        {formData.driver !== "sqlite" && (
          <>
            <div>
              <label htmlFor={validation.id("host")} className={styles.label}>{t("hostAddress")}</label>
              <input {...validation.field("host")}
                type="text"
                value={formData.host}
                onChange={(event) => onChange({ ...formData, host: event.target.value })}
                data-testid="connection-host-input"
                className={styles.control}
                placeholder="localhost"
                required
              />
              {validation.error("host")}
            </div>
            <div>
              <label htmlFor={validation.id("port")} className={styles.label}>{t("port")}</label>
              <input {...validation.field("port")}
                type="number"
                value={Number.isFinite(formData.port) ? formData.port : ""}
                min={1}
                max={65535}
                step={1}
                onChange={(event) =>
                  onChange({ ...formData, port: event.target.valueAsNumber })
                }
                data-testid="connection-port-input"
                className={styles.control}
                required
              />
              {validation.error("port")}
            </div>
          </>
        )}
        <div className={formData.driver === "sqlite" ? styles.fullWidth : undefined}>
          <label htmlFor={validation.id("database")} className={styles.label}>
            {formData.driver === "sqlite" ? t("databaseFilePath") : t("databaseName")}
          </label>
          <input {...validation.field("database")}
            type="text"
            value={formData.database}
            onChange={(event) => onChange({ ...formData, database: event.target.value })}
            data-testid="connection-database-input"
            className={styles.control}
            placeholder={formData.driver === "sqlite" ? "/path/to/database.db" : "mydb"}
            required
          />
          {validation.error("database")}
        </div>
        {formData.driver !== "sqlite" && (
          <>
            <div>
              <label htmlFor={validation.id("username")} className={styles.label}>{t("username")}</label>
              <input {...validation.field("username")}
                type="text"
                value={formData.username}
                onChange={(event) => onChange({ ...formData, username: event.target.value })}
                data-testid="connection-username-input"
                className={styles.control}
                placeholder="root"
                required
              />
              {validation.error("username")}
            </div>
            <div>
              <label htmlFor={validation.id("password")} className={styles.label}>
                {t("password")}
                {editingId && (
                  <span className="text-muted-foreground font-normal ml-2">{t("passwordHint")}</span>
                )}
              </label>
              <input {...validation.field("password")}
                type="password"
                value={formData.password}
                onChange={(event) => onChange({ ...formData, password: event.target.value })}
                data-testid="connection-password-input"
                className={styles.control}
                placeholder={editingId ? t("passwordPlaceholder") : "••••••••"}
              />
            </div>
          </>
        )}
        {formData.driver !== "sqlite" && (
          <SettingsDisclosure
            title={t("security.title")}
            open={advanced.open}
            onToggle={(event) => { const open = event.currentTarget.open; setAdvanced(current => current.open === open ? current : { ...current, open }); }}
            data-testid="connection-security-options"
          >
            <div className={styles.grid}>
              <div>
                <label htmlFor={validation.id("sslmode")} className={styles.label}>
                  {t("security.encryption")}
                </label>
                <select {...validation.field("sslmode")}
                  value={formData.extra_options.sslmode}
                  onChange={(event) => {
                    const sslmode =
                      event.target.value as typeof formData.extra_options.sslmode;
                    onChange({
                      ...formData,
                      extra_options: {
                        ...formData.extra_options,
                        sslmode,
                        ...(sslmode === "disable"
                          ? { sslrootcert: "", sslcert: "", sslkey: "" }
                          : {}),
                      },
                    });
                  }}
                  data-testid="connection-sslmode-select"
                  className={styles.control}
                >
                  <option value="prefer">{t("security.sslMode.prefer")}</option>
                  <option value="require">{t("security.sslMode.require")}</option>
                  <option value="verify-ca">{t("security.sslMode.verifyCa")}</option>
                  <option value="verify-full">{t("security.sslMode.verifyFull")}</option>
                  <option value="disable">{t("security.sslMode.disable")}</option>
                </select>
                {validation.error("sslmode")}
              </div>
              {formData.driver === "postgresql" && (
                <div>
                  <label htmlFor={validation.id("schema")} className={styles.label}>
                    {t("security.schema")}
                  </label>
                  <input {...validation.field("schema")}
                    type="text"
                    value={formData.extra_options.schema}
                    onChange={(event) =>
                      onChange({
                        ...formData,
                        extra_options: {
                          ...formData.extra_options,
                          schema: event.target.value,
                        },
                      })
                    }
                    data-testid="connection-schema-input"
                    className={styles.control}
                    placeholder="public"
                  />
                  {validation.error("schema")}
                </div>
              )}
              {formData.extra_options.sslmode !== "disable" && (
                <>
                  <div>
                    <label htmlFor={validation.id("sslrootcert")} className={styles.label}>
                      {t("security.caCertificatePath")}
                    </label>
                    <input {...validation.field("sslrootcert")}
                      type="text"
                      value={formData.extra_options.sslrootcert}
                      onChange={(event) =>
                        onChange({
                          ...formData,
                          extra_options: {
                            ...formData.extra_options,
                            sslrootcert: event.target.value,
                          },
                        })
                      }
                      data-testid="connection-ca-path-input"
                      className={styles.control}
                      placeholder="/path/to/ca.pem"
                    />
                    {validation.error("sslrootcert")}
                  </div>
                  <div>
                    <label htmlFor={validation.id("sslcert")} className={styles.label}>
                      {t("security.clientCertificatePath")}
                    </label>
                    <input {...validation.field("sslcert")}
                      type="text"
                      value={formData.extra_options.sslcert}
                      onChange={(event) =>
                        onChange({
                          ...formData,
                          extra_options: {
                            ...formData.extra_options,
                            sslcert: event.target.value,
                          },
                        })
                      }
                      data-testid="connection-client-cert-input"
                      className={styles.control}
                      placeholder="/path/to/client.pem"
                    />
                    {validation.error("sslcert")}
                  </div>
                  <div>
                    <label htmlFor={validation.id("sslkey")} className={styles.label}>
                      {t("security.clientKeyPath")}
                    </label>
                    <input {...validation.field("sslkey")}
                      type="text"
                      value={formData.extra_options.sslkey}
                      onChange={(event) =>
                        onChange({
                          ...formData,
                          extra_options: {
                            ...formData.extra_options,
                            sslkey: event.target.value,
                          },
                        })
                      }
                      data-testid="connection-client-key-input"
                      className={styles.control}
                      placeholder="/path/to/client.key"
                    />
                    {validation.error("sslkey")}
                  </div>
                </>
              )}
            </div>
          </SettingsDisclosure>
        )}
        <div className={styles.fullWidth}>
          <label htmlFor={validation.id("is_default")} className={styles.checkbox}>
            <input {...validation.field("is_default")}
              type="checkbox"
              checked={formData.is_default}
              onChange={(event) => onChange({ ...formData, is_default: event.target.checked })}
              data-testid="connection-default-checkbox"
              className="w-4 h-4 text-primary rounded focus:ring-ring"
            />
            <span className="text-sm text-foreground">{t("setAsDefault")}</span>
          </label>
        </div>
      </div>
    </SettingsForm>
  );
}
