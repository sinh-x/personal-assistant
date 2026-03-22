import yaml from "js-yaml";

/** Block field: 'all' blocks everyone, array blocks specific teams */
export type BulletinBlock = "all" | string[];

/** A bulletin parsed from YAML frontmatter + markdown body */
export interface Bulletin {
  id: string;
  title: string;
  status: "active" | "resolved";
  block: BulletinBlock;
  except: string[];
  created: string;
  body: string;
  /** The filename (without path) the bulletin was loaded from */
  filename: string;
}

/** Raw YAML frontmatter fields as stored on disk */
interface BulletinFrontmatter {
  id: string;
  title: string;
  status: "active" | "resolved";
  block: "all" | string[];
  except?: string[];
  created: string;
}

/**
 * Parse a bulletin markdown file (YAML frontmatter + body).
 * Returns undefined if the content is malformed.
 */
export function parseBulletin(content: string, filename: string): Bulletin | undefined {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return undefined;

  const frontmatterStr = match[1];
  const body = match[2].trim();

  try {
    const fm = yaml.load(frontmatterStr) as BulletinFrontmatter;
    if (!fm.id || !fm.title || !fm.status || fm.block === undefined) return undefined;
    return {
      id: String(fm.id),
      title: fm.title,
      status: fm.status,
      block: fm.block,
      except: fm.except ?? [],
      created: String(fm.created),
      body,
      filename,
    };
  } catch {
    return undefined;
  }
}

/**
 * Serialize a Bulletin back to its YAML frontmatter + markdown body format.
 */
export function serializeBulletin(b: Omit<Bulletin, "filename">): string {
  const fm: BulletinFrontmatter = {
    id: b.id,
    title: b.title,
    status: b.status,
    block: b.block,
    created: b.created,
  };
  if (b.except.length > 0) {
    fm.except = b.except;
  }

  const yamlStr = (yaml.dump(fm, { lineWidth: -1 }) as string).trim();
  return `---\n${yamlStr}\n---\n\n${b.body}\n`;
}
