import { calculateBom, type PriceLine } from '../cost/bom';
import lamHa from '../../data/presets/lam-ha.json';

export interface DraftProject {
  name: string;
  status: 'draft';
  currency: string;
  lines: (PriceLine & { label: string; source: string })[];
}

export function createProject(name: string): DraftProject {
  return { name: name.trim() || 'Dự án mới', status: 'draft', currency: 'VND', lines: [] };
}

export function openLamHa(): DraftProject {
  return { name: lamHa.name, status: 'draft', currency: lamHa.currency, lines: structuredClone(lamHa.lines) };
}

export function bomOf(p: DraftProject) {
  return calculateBom(p.lines, p.currency);
}
