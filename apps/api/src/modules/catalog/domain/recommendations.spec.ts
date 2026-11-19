import { DEFAULT_RECOMMENDATIONS, normalizeSkus, onlyActive, recommendationsText, resolveRecommendations } from './recommendations';

describe('recomendados por tipo de cliente', () => {
  it('usa lo guardado y, si no hay, la lista por defecto', () => {
    const r = resolveRecommendations([{ segment: 'PIZZERIA', skus: ['133'] }]);
    expect(r.PIZZERIA).toEqual(['133']);
    expect(r.ROTISERIA).toEqual(DEFAULT_RECOMMENDATIONS.ROTISERIA);
  });

  it('una lista guardada vacía queda vacía (no vuelve a la de defecto)', () => {
    expect(resolveRecommendations([{ segment: 'CATERING', skus: [] }]).CATERING).toEqual([]);
  });

  it('limpia códigos repetidos y espacios', () => {
    expect(normalizeSkus([' 179-u', '179-U', '41-U', ''])).toEqual(['179-U', '41-U']);
  });

  it('saca los dados de baja sin cambiar el orden', () => {
    const r = onlyActive(resolveRecommendations([{ segment: 'PASTELERIA', skus: ['75', '999', '77'] }]), new Set(['77', '75']));
    expect(r.PASTELERIA).toEqual(['75', '77']);
  });

  it('arma el texto para el asistente con los nombres', () => {
    const lists = resolveRecommendations(['MINORISTA', 'ROTISERIA', 'CATERING', 'PIZZERIA', 'PASTELERIA'].map((segment) => ({ segment, skus: [] })));
    lists.PIZZERIA = ['133', 'X'];
    const text = recommendationsText(lists, (sku) => (sku === '133' ? '[133] Orégano en Hojas × 1 kg' : null));
    expect(text).toContain('- Pizzería: [133] Orégano en Hojas × 1 kg');
    expect(text).not.toContain('Rotisería');
  });
});
