import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';

// Módulos del roadmap que todavía no tienen pantalla: indica en qué sprint llegan.
const ROADMAP: Record<string, { title: string; sprint: string }> = {
  inbox: { title: 'WhatsApp', sprint: 'Sprint 3' },
  sales: { title: 'Ventas y embudo', sprint: 'Sprint 2' },
  orders: { title: 'Pedidos', sprint: 'Sprint 2' },
  inventory: { title: 'Inventario', sprint: 'Sprint 2' },
  logistics: { title: 'Logística', sprint: 'Fase 2' },
  receivables: { title: 'Cobranza', sprint: 'Sprint 3' },
  documents: { title: 'Documentos', sprint: 'Sprint 4' },
  automation: { title: 'Automatizaciones', sprint: 'Sprint 5' },
  analytics: { title: 'Inteligencia comercial', sprint: 'Sprint 5' },
  settings: { title: 'Configuración', sprint: 'Sprint 0' },
};

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const entry = ROADMAP[module];
  if (!entry) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-semibold">{entry.title}</h1>
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          La API de este módulo ya está disponible y el copiloto puede consultarlo. La pantalla llega en {entry.sprint}.
        </CardContent>
      </Card>
    </div>
  );
}
