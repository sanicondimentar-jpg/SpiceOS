import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';

// Módulos del menú que todavía no tienen pantalla: qué van a hacer y qué se puede usar hoy.
const PENDING: Record<string, { title: string; summary: string; features: string[]; today?: string }> = {
  logistics: {
    title: 'Logística',
    summary: 'Organización de los repartos de los pedidos listos para entregar.',
    features: [
      'Hoja de ruta del día agrupando pedidos por zona.',
      'Quién reparte, en qué vehículo y en qué orden.',
      'Marcar entregado desde el celular, con observaciones.',
    ],
    today: 'El avance de cada pedido se sigue en el tablero de Inicio.',
  },
  documents: {
    title: 'Documentos',
    summary: 'Archivo de documentos del negocio en un solo lugar.',
    features: [
      'Fichas técnicas, certificados, contratos y listas de proveedores.',
      'Conexión con Google Drive para traer los archivos.',
      'El copiloto puede leerlos para responder preguntas.',
    ],
  },
  automation: {
    title: 'Automatizaciones',
    summary: 'Reglas que hacen tareas solas cuando pasa algo.',
    features: [
      'Avisos de stock bajo o productos por vencer.',
      'Recordatorio a clientes con deuda vencida o que hace tiempo no compran.',
      'Ver qué reglas corrieron y qué hicieron.',
    ],
  },
};

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const entry = PENDING[module];
  if (!entry) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold">{entry.title}</h1>
      <p className="mb-4 text-sm text-muted-foreground">Módulo en construcción.</p>
      <Card>
        <CardContent className="space-y-4 p-6 text-sm">
          <p>{entry.summary}</p>
          <div>
            <p className="mb-2 font-medium">Qué va a hacer</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {entry.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          {entry.today && <p className="text-muted-foreground">Mientras tanto: {entry.today}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
