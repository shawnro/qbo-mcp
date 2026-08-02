// CRUD disable flags — filter tools based on environment variables
// QBO_DISABLE_CREATE=true  → hides all create_* tools
// QBO_DISABLE_UPDATE=true  → hides all edit_* and deactivate_* tools
// QBO_DISABLE_DELETE=true  → hides delete_entity tool

type CrudCategory = "create" | "update" | "delete" | "read";

const PREFIX_MAP: Array<[string, CrudCategory]> = [
  ["create_", "create"],
  ["edit_", "update"],
  ["deactivate_", "update"],
  ["delete_", "delete"],
];

const ENV_MAP: Record<Exclude<CrudCategory, "read">, string> = {
  create: "QBO_DISABLE_CREATE",
  update: "QBO_DISABLE_UPDATE",
  delete: "QBO_DISABLE_DELETE",
};

export function getCrudCategory(toolName: string): CrudCategory {
  for (const [prefix, category] of PREFIX_MAP) {
    if (toolName.startsWith(prefix)) return category;
  }
  return "read";
}

export function isToolDisabled(toolName: string): boolean {
  const category = getCrudCategory(toolName);
  if (category === "read") return false;
  return process.env[ENV_MAP[category]] === "true";
}

export function filterTools<T extends { name: string }>(definitions: T[]): T[] {
  return definitions.filter((tool) => !isToolDisabled(tool.name));
}
