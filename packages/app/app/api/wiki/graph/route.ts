import { getServerRuntime } from '@/lib/runtime';
import { NextResponse } from 'next/server';
import {
  readAllPages,
  ensureWikiDirExists,
  pageNameToFilename,
} from '@the-thing/core';

export const runtime = 'nodejs';

interface GraphNode {
  id: string;
  name: string;
  category: string;
  description: string;
  linkCount: number;
}

interface GraphEdge {
  source: string;
  target: string;
}

export async function GET() {
  try {
    const rt = await getServerRuntime();
    const memoryDir = rt.layout.resources.wiki[0];

    if (!memoryDir) {
      return NextResponse.json({ nodes: [], edges: [] });
    }

    const wikiDir = memoryDir;
    await ensureWikiDirExists(wikiDir);

    const pages = await readAllPages(wikiDir);

    // Build filename → page name mapping, and page-name → real filename mapping.
    // 页面链接引用的是 name（[[name]]），但节点 id 是真实相对路径（category/name.md），
    // 因此需要 name 反查真实 filename，保证 edge 两端都是有效 node id。
    const filenameToName = new Map<string, string>();
    const nameToFilename = new Map<string, string>();
    for (const page of pages) {
      filenameToName.set(page.filename, page.data.name);
      nameToFilename.set(pageNameToFilename(page.data.name), page.filename);
    }

    // Build nodes and extract edges from [[wiki-link]] references
    const nodes: GraphNode[] = [];
    const edgeSet = new Set<string>();
    const edges: GraphEdge[] = [];
    const inboundCount = new Map<string, number>();

    for (const page of pages) {
      nodes.push({
        id: page.filename,
        name: page.data.name,
        category: page.data.category,
        description: page.data.description,
        linkCount: 0,
      });

      // Extract [[wiki-link]] references
      const links = page.content.match(/\[\[(.+?)\]\]/g) || [];
      for (const link of links) {
        const linkName = link.replace(/\[\[|\]\]/g, '');
        const targetFilename = nameToFilename.get(pageNameToFilename(linkName));

        // Only add edge if target exists as a page
        if (targetFilename && filenameToName.has(targetFilename)) {
          const edgeKey = `${page.filename}→${targetFilename}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            edges.push({ source: page.filename, target: targetFilename });

            // Count inbound links
            inboundCount.set(
              targetFilename,
              (inboundCount.get(targetFilename) || 0) + 1,
            );
          }
        }
      }
    }

    // Set linkCount = inbound + outbound for each node
    for (const node of nodes) {
      const outbound = edges.filter((e) => e.source === node.id).length;
      const inbound = inboundCount.get(node.id) || 0;
      node.linkCount = inbound + outbound;
    }

    return NextResponse.json({ nodes, edges });
  } catch (error) {
    console.error('[Wiki Graph API] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to build wiki graph' },
      { status: 500 },
    );
  }
}
