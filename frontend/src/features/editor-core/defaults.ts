const EDITOR_CORE_SUPPORTED_FIELDS: Record<string, Set<string>> = {
  podvodka: new Set(["text"]),
  zk: new Set(["text"]),
  life: new Set(["text"]),
  snh: new Set(["text", "speaker_fio", "speaker_position"]),
  zk_geo: new Set(["text", "geo"]),
};

export function canUseEditorCoreField(blockType: string, target: string): boolean {
  const normalizedBlockType = (blockType || "").trim().toLowerCase();
  return EDITOR_CORE_SUPPORTED_FIELDS[normalizedBlockType]?.has(target) ?? false;
}
