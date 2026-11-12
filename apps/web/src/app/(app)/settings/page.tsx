import Link from 'next/link';
import { MessageCircle, Receipt } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Configuración</h1>
      <Link href="/settings/invoicing" className="block">
        <Card className="hover:bg-accent">
          <CardContent className="flex items-center gap-3 p-5">
            <Receipt className="h-5 w-5 text-primary" />
            <div>
              <div className="font-medium">Facturación electrónica</div>
              <div className="text-sm text-muted-foreground">Datos fiscales, certificado de ARCA y punto de venta para facturar desde los pedidos.</div>
            </div>
          </CardContent>
        </Card>
      </Link>
      <Link href="/settings/whatsapp" className="block">
        <Card className="hover:bg-accent">
          <CardContent className="flex items-center gap-3 p-5">
            <MessageCircle className="h-5 w-5 text-primary" />
            <div>
              <div className="font-medium">WhatsApp</div>
              <div className="text-sm text-muted-foreground">Conectar el número de la empresa para recibir y responder mensajes desde el sistema.</div>
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
