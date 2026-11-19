import { WhatsappReceiptsConsumer } from './whatsapp-receipts.consumer';

function setup(waContactId: string, already = false) {
  const tx = {
    message: { findFirst: jest.fn().mockResolvedValue({ id: 'm1', mediaKey: 'media-1', conversation: { waContactId, account: { phoneNumberId: '1' } } }) },
    supplier: { findMany: jest.fn().mockResolvedValue([{ id: 's1', legalName: 'Especias 51', receiptPhones: ['1170580234'] }]) },
    pendingReceipt: { findFirst: jest.fn().mockResolvedValue(already ? { id: 'p0' } : null) },
  };
  const uow = { read: (fn: (t: typeof tx) => unknown) => fn(tx) };
  const whatsapp = { downloadMedia: jest.fn().mockResolvedValue({ data: Buffer.from('img'), mimeType: 'image/jpeg' }) };
  const pending = { create: jest.fn().mockResolvedValue({ id: 'p1', reading: { lines: [] } }) };
  const consumer = new WhatsappReceiptsConsumer({} as never, uow as never, whatsapp as never, pending as never);
  return { consumer, whatsapp, pending };
}

const payload = (type: string) => ({ conversationId: 'c1', messageId: 'm1', customerId: null, leadId: null, type, text: null });

describe('remitos por WhatsApp', () => {
  it('lee la foto de un teléfono autorizado y la deja por confirmar con el proveedor', async () => {
    const { consumer, pending } = setup('5491170580234');
    await consumer.handle(payload('image'));
    expect(pending.create).toHaveBeenCalledWith(expect.objectContaining({ source: 'WHATSAPP', supplierId: 's1', sender: '+5491170580234', messageId: 'm1' }));
  });

  it('ignora fotos de otros números, mensajes de texto y fotos ya leídas', async () => {
    for (const [phone, type, already] of [['5491100000000', 'image', false], ['5491170580234', 'text', false], ['5491170580234', 'image', true]] as const) {
      const { consumer, pending, whatsapp } = setup(phone, already);
      await consumer.handle(payload(type));
      expect(whatsapp.downloadMedia).not.toHaveBeenCalled();
      expect(pending.create).not.toHaveBeenCalled();
    }
  });
});
