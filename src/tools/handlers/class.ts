// Handlers for class tools (create, get, edit)

import QuickBooks from "node-quickbooks";
import { promisify } from "../../client/index.js";
import { outputReport } from "../../utils/index.js";
import type { QboRequestContext } from "../../runtime/types.js";

interface QBClass {
  Id: string;
  SyncToken: string;
  Name: string;
  FullyQualifiedName?: string;
  Active?: boolean;
  SubClass?: boolean;
  ParentRef?: { value: string; name?: string };
  MetaData?: { CreateTime?: string; LastUpdatedTime?: string };
}

async function resolveParentClass(
  client: QuickBooks,
  parentNameOrId: string
): Promise<{ value: string; name?: string }> {
  // Try as ID first (numeric string)
  if (/^\d+$/.test(parentNameOrId)) {
    try {
      const cls = await promisify<unknown>((cb) =>
        client.getClass(parentNameOrId, cb)
      ) as QBClass;
      return { value: cls.Id, name: cls.Name };
    } catch {
      // Fall through to name lookup
    }
  }

  // Look up by name
  const result = await promisify<unknown>((cb) =>
    client.findClasses({ fetchAll: true }, cb)
  ) as { QueryResponse: { Class?: QBClass[] } };
  const classes = result.QueryResponse?.Class || [];
  const match = classes.find(
    (c) => c.Name.toLowerCase() === parentNameOrId.toLowerCase()
  );
  if (!match) {
    const available = classes.map((c) => c.Name).join(", ");
    throw new Error(
      `Parent class not found: "${parentNameOrId}". Available: ${available}`
    );
  }
  return { value: match.Id, name: match.Name };
}

export async function handleCreateClass(
  client: QuickBooks,
  args: {
    name: string;
    parent_name?: string;
    parent_id?: string;
    active?: boolean;
    draft?: boolean;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { name, parent_name, parent_id, active, draft = true } = args;

  const classObj: Record<string, unknown> = { Name: name };
  if (active !== undefined) classObj.Active = active;

  // Resolve parent
  let parentLabel: string | undefined;
  const parentRef = parent_id || parent_name;
  if (parentRef) {
    const parent = await resolveParentClass(client, parentRef);
    classObj.ParentRef = parent;
    parentLabel = parent.name || parent.value;
  }

  if (draft) {
    const preview = [
      "DRAFT - Class Preview",
      "",
      `Name: ${name}`,
      ...(parentLabel ? [`Parent: ${parentLabel}`] : []),
      `Active: ${active !== undefined ? active : true}`,
      "",
      "Set draft=false to create this class.",
    ].join("\n");

    return { content: [{ type: "text", text: preview }] };
  }

  const result = (await promisify<unknown>((cb) =>
    client.createClass(classObj, cb)
  )) as QBClass;

  const response = [
    "Class Created!",
    "",
    `ID: ${result.Id}`,
    `Name: ${result.Name}`,
    ...(result.FullyQualifiedName && result.FullyQualifiedName !== result.Name
      ? [`Fully Qualified Name: ${result.FullyQualifiedName}`]
      : []),
  ].join("\n");

  return { content: [{ type: "text", text: response }] };
}

export async function handleGetClass(
  client: QuickBooks,
  args: { id: string },
  context?: QboRequestContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { id } = args;

  const cls = (await promisify<unknown>((cb) =>
    client.getClass(id, cb)
  )) as QBClass;

  const lines: string[] = [
    "Class",
    "=====",
    `ID: ${cls.Id}`,
    `SyncToken: ${cls.SyncToken}`,
    `Name: ${cls.Name}`,
    ...(cls.FullyQualifiedName && cls.FullyQualifiedName !== cls.Name
      ? [`Fully Qualified Name: ${cls.FullyQualifiedName}`]
      : []),
    `Active: ${cls.Active !== false}`,
    ...(cls.SubClass ? ["Sub-class: true"] : []),
    ...(cls.ParentRef
      ? [`Parent: ${cls.ParentRef.name || cls.ParentRef.value}`]
      : []),
  ];

  if (cls.MetaData) {
    if (cls.MetaData.CreateTime)
      lines.push(`Created: ${cls.MetaData.CreateTime}`);
    if (cls.MetaData.LastUpdatedTime)
      lines.push(`Last Updated: ${cls.MetaData.LastUpdatedTime}`);
  }

  return outputReport(`class-${cls.Id}`, cls, lines.join("\n"), context?.output);
}

export async function handleEditClass(
  client: QuickBooks,
  args: {
    id: string;
    name?: string;
    active?: boolean;
    parent_name?: string;
    parent_id?: string;
    draft?: boolean;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { id, name, active, parent_name, parent_id, draft = true } = args;

  // Fetch current
  const current = (await promisify<unknown>((cb) =>
    client.getClass(id, cb)
  )) as QBClass;

  // Build sparse update
  const updated: Record<string, unknown> = {
    Id: current.Id,
    SyncToken: current.SyncToken,
    sparse: true,
  };

  if (name !== undefined) updated.Name = name;
  if (active !== undefined) updated.Active = active;

  // Resolve parent
  const parentRef = parent_id || parent_name;
  if (parentRef !== undefined) {
    if (parentRef === "") {
      // Clear parent - make top-level
      updated.ParentRef = null;
    } else {
      const parent = await resolveParentClass(client, parentRef);
      updated.ParentRef = parent;
    }
  }

  if (draft) {
    const previewLines: string[] = [
      "DRAFT - Class Edit Preview",
      "",
      `ID: ${id}`,
      `SyncToken: ${current.SyncToken}`,
      "",
      "Changes:",
    ];

    if (name !== undefined)
      previewLines.push(`  Name: ${current.Name} → ${name}`);
    if (active !== undefined)
      previewLines.push(
        `  Active: ${current.Active !== false} → ${active}`
      );
    if (parentRef !== undefined) {
      const currentParent =
        current.ParentRef?.name || current.ParentRef?.value || "(none)";
      if (parentRef === "") {
        previewLines.push(`  Parent: ${currentParent} → (none)`);
      } else {
        const newParent =
          updated.ParentRef &&
          typeof updated.ParentRef === "object" &&
          "name" in (updated.ParentRef as object)
            ? (updated.ParentRef as { name?: string }).name
            : parentRef;
        previewLines.push(`  Parent: ${currentParent} → ${newParent}`);
      }
    }

    previewLines.push("", "Set draft=false to apply changes.");

    return { content: [{ type: "text", text: previewLines.join("\n") }] };
  }

  const result = (await promisify<unknown>((cb) =>
    client.updateClass(updated, cb)
  )) as QBClass;

  const response = [
    "Class Updated!",
    "",
    `ID: ${result.Id}`,
    `Name: ${result.Name}`,
    `Active: ${result.Active !== false}`,
    ...(result.FullyQualifiedName && result.FullyQualifiedName !== result.Name
      ? [`Fully Qualified Name: ${result.FullyQualifiedName}`]
      : []),
  ].join("\n");

  return { content: [{ type: "text", text: response }] };
}
