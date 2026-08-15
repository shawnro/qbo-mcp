const MAX_AMBIGUITY_CANDIDATES = 5;

export interface NameCandidate<T> {
  value: T;
  names: Array<string | undefined>;
  label: string;
}

export function resolveUniqueName<T>(
  entity: string,
  input: string,
  candidates: Array<NameCandidate<T>>
): T | undefined {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return undefined;

  const matches = (exact: boolean) => candidates.filter(candidate =>
    candidate.names.some(name => {
      const candidateName = name?.trim().toLowerCase();
      return candidateName && (exact ? candidateName === normalized : candidateName.includes(normalized));
    })
  );

  const exactMatches = matches(true);
  if (exactMatches.length === 1) return exactMatches[0].value;
  if (exactMatches.length > 1) throw ambiguityError(entity, input, exactMatches);

  const partialMatches = matches(false);
  if (partialMatches.length === 1) return partialMatches[0].value;
  if (partialMatches.length > 1) throw ambiguityError(entity, input, partialMatches);
  return undefined;
}

function ambiguityError<T>(
  entity: string,
  input: string,
  matches: Array<NameCandidate<T>>
): Error {
  const visible = matches
    .slice(0, MAX_AMBIGUITY_CANDIDATES)
    .map(match => match.label)
    .join(", ");
  const remaining = matches.length - MAX_AMBIGUITY_CANDIDATES;
  const suffix = remaining > 0 ? `, and ${remaining} more` : "";
  return new Error(
    `${entity} name is ambiguous: "${input}". ` +
    `Use an exact name or ID. Matches: ${visible}${suffix}`
  );
}