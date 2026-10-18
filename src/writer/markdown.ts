import { t } from "../i18n";
export type MarkdownDocument = { title: string; frontmatter: string; body: string };

// YAML (---) and TOML (+++) frontmatter.
const FRONTMATTER = /^(?:---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)|\+\+\+[ \t]*\n[\s\S]*?\n\+\+\+)[ \t]*(?:\n|$)/;
const unquote = (value: string): string => value.trim().replace(/^(["'])(.*)\1$/, "$2");

/**
 * Splits a Markdown file into YAML/TOML frontmatter and body. The frontmatter is kept verbatim (it is
 * not part of the prose under review) and restored by `serializeMarkdown`.
 */
export const parseMarkdown = (raw: string, fileName = ""): MarkdownDocument => {
  const source = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const matched = FRONTMATTER.exec(source);
  const frontmatter = matched ? (matched[0].endsWith("\n") ? matched[0] : `${matched[0]}\n`) : "";
  const body = matched ? source.slice(matched[0].length) : source;
  const fromFrontmatter = /^title[ \t]*[:=][ \t]*(.+)$/m.exec(frontmatter)?.[1];
  const fromHeading = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(body)?.[1];
  const fromFile = fileName.replace(/\.[^./\\]+$/, "");
  const title = [fromFrontmatter && unquote(fromFrontmatter), fromHeading, fromFile].find((value) => value?.trim());
  return { title: title?.trim() ?? t("ui.untitled"), frontmatter, body };
};

export const serializeMarkdown = ({ frontmatter, body }: Pick<MarkdownDocument, "frontmatter" | "body">): string =>
  `${frontmatter}${body}`;

export const deriveTitle = (body: string, frontmatter = ""): string => parseMarkdown(`${frontmatter}${body}`).title;
