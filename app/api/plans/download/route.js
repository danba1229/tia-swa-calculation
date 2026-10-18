import { get } from '@vercel/blob';
import registry from '../../../../data/plans/registry.json';
import { createPlanDownloadHandler } from '../../../../lib/planDownloadHandler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createPlanDownloadHandler({ registry, getBlob: get });
