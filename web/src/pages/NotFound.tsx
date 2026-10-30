import { Crossing } from "../components/Crossing";
import { Magnetic } from "../components/Magnetic";
import { useI18n } from "../lib/i18n";
import "./app.css";

export function NotFound() {
  const { t } = useI18n();
  return (
    <div className="page wrap not-found">
      <Crossing from="USDT" to="USDT" size="sm" />
      <p className="lead" style={{ margin: 0 }}>
        {t("notFound")}
      </p>
      <Magnetic to="/" variant="ghost">
        Cruce
      </Magnetic>
    </div>
  );
}
