import type { ProductionReadModel } from "../types";


const formatDateTime = (value: string) => new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
}).format(new Date(value));

export default function VoiceoverState({ voiceover }: { voiceover: ProductionReadModel["voiceover"] }) {
  return (
    <section className="production-section production-voiceover" aria-labelledby="production-voiceover-title">
      <header className="production-section-head">
        <div>
          <p className="production-kicker">Готовность</p>
          <h3 id="production-voiceover-title">Озвучка</h3>
        </div>
        <strong className={`production-binary-state ${voiceover.ready ? "is-ready" : "is-pending"}`}>
          {voiceover.ready ? "Готова" : "Не готова"}
        </strong>
      </header>
      {voiceover.ready && voiceover.ready_by && voiceover.ready_at ? (
        <p className="production-state-meta">
          {voiceover.ready_by.display_name} · {formatDateTime(voiceover.ready_at)}
        </p>
      ) : null}
    </section>
  );
}
