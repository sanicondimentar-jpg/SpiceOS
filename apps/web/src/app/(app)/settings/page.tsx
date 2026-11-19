import Link from 'next/link';
import { FolderOpen, KeyRound, MessageCircle, Receipt, Sparkles, Wallet } from 'lucide-react';
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
      <Link href="/settings/recommendations" className="block">
        <Card className="hover:bg-accent">
          <CardContent className="flex items-center gap-3 p-5">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <div className="font-medium">Productos recomendados</div>
              <div className="text-sm text-muted-foreground">Lo que la web muestra primero a minoristas y a cada rubro mayorista, y lo que ofrece primero el asistente de WhatsApp.</div>
            </div>
          </CardContent>
        </Card>
      </Link>
      <Link href="/settings/collections" className="block">
        <Card className="hover:bg-accent">
          <CardContent className="flex items-center gap-3 p-5">
            <Wallet className="h-5 w-5 text-primary" />
            <div>
              <div className="font-medium">Cobranza</div>
              <div className="text-sm text-muted-foreground">Plazo de pago (30 días) y avisos de vencimiento por WhatsApp a vos y a los clientes.</div>
            </div>
          </CardContent>
        </Card>
      </Link>
      <Link href="/settings/integrations" className="block">
        <Card className="hover:bg-accent">
          <CardContent className="flex items-center gap-3 p-5">
            <FolderOpen className="h-5 w-5 text-primary" />
            <div>
              <div className="font-medium">Google Drive</div>
              <div className="text-sm text-muted-foreground">Traer a Documentos los archivos de las carpetas de Drive que elijas, y mantenerlos al día solos.</div>
            </div>
          </CardContent>
        </Card>
      </Link>
      <Link href="/settings/api-keys" className="block">
        <Card className="hover:bg-accent">
          <CardContent className="flex items-center gap-3 p-5">
            <KeyRound className="h-5 w-5 text-primary" />
            <div>
              <div className="font-medium">Claves de acceso</div>
              <div className="text-sm text-muted-foreground">Para que Claude cargue remitos de compra desde el chat. Quedan por confirmar, no suman stock solos.</div>
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
