import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isIdealistaDetailUrl,
  parseIdealistaDetail,
} from '../src/adapters/idealista/index.js';

const fixture = (name: string) => readFile(path.join('tests', 'fixtures', 'idealista', name), 'utf8');

const detailUrl = 'https://www.idealista.com/inmueble/112536871/';

describe('Idealista detail URL recognition', () => {
  it('accepts numeric detail URLs only', () => {
    expect(isIdealistaDetailUrl(detailUrl)).toBe(true);
    expect(isIdealistaDetailUrl('https://idealista.com/inmueble/123/')).toBe(true);
    expect(isIdealistaDetailUrl('https://www.idealista.com/alquiler-viviendas/barcelona-barcelona/')).toBe(false);
    expect(isIdealistaDetailUrl('https://www.idealista.com/')).toBe(false);
    expect(isIdealistaDetailUrl('https://example.com/inmueble/123/')).toBe(false);
    expect(isIdealistaDetailUrl('not a URL')).toBe(false);
  });

  it('reports search pages as unsupported instead of parsing them', async () => {
    const result = parseIdealistaDetail({ html: '<html><body><h1>Search</h1></body></html>', url: 'https://www.idealista.com/alquiler-viviendas/barcelona-barcelona/' });
    expect(result.page_type).toBe('unsupported');
    expect(result.listing).toBeNull();
    expect(result.errors).toEqual(['Unsupported Idealista URL: detail listing expected']);
  });
});

describe('Idealista listing parsing', () => {
  it('extracts the active listing fields and source evidence', async () => {
    const result = parseIdealistaDetail({ html: await fixture('active-detail.html'), url: detailUrl });
    expect(result.page_type).toBe('detail');
    expect(result.completeness).toEqual({
      accepted: true,
      expected_id_found: true,
      price_found: true,
      property_metadata_found: true,
      spanish_description_found: true,
      advertiser_found: true,
      rejection_reasons: [],
    });
    expect(result.listing).toMatchObject({
      idealista_id: '112536871',
      language: 'es',
      listing_state: 'active',
      facts: {
        title: 'Piso luminoso en Sant Martí',
        price_eur_month: 3180,
        size_m2_built: 132,
        size_m2_usable: 92,
        bedrooms: 3,
        bathrooms: 2,
        floor_text: '5ª planta exterior',
        location_text: 'El Parc i la Llacuna del Poblenou, Sant Martí, Barcelona',
        neighborhood_or_area: 'El Parc i la Llacuna del Poblenou',
        district: 'Sant Martí',
        city: 'Barcelona',
      },
      spanish_description: 'Precioso piso amueblado con terraza.\nDisponible para alquiler de temporada.',
      advertiser: {
        name: 'Real Estate Barcino',
        type_text: 'Profesional',
        reference: 'BAR-123',
      },
      occupancy_profile: ['Máximo 6 personas', 'Niños'],
    });
    expect(result.listing?.property_feature_groups).toEqual({
      'Características básicas': ['132 m² construidos', '92 m² útiles', '3 habitaciones', '2 baños'],
      Edificio: ['5ª planta exterior', 'Con ascensor'],
      Equipamiento: ['Aire acondicionado', 'Piscina'],
      Precio: ['Fianza de 1 mes', 'Alquiler de temporada'],
      Ubicación: ['Metro a 4 minutos.'],
    });
    expect(result.listing?.price_terms).toEqual(['Fianza de 1 mes', 'Alquiler de temporada']);
    expect(result.listing?.text_evidence.deposit_guarantees).toEqual(['Fianza de 1 mes']);
    expect(result.listing?.text_evidence.income_documents).toEqual(['Documentación y nóminas necesarias.']);
    expect(result.listing?.text_evidence.transport_location).toEqual(['Metro a 4 minutos.']);
  });

  it('ignores malformed JSON-LD and uses HTML fallbacks', async () => {
    const result = parseIdealistaDetail({ html: await fixture('malformed-jsonld.html'), url: detailUrl });
    expect(result.listing?.facts.title).toBe('Apartamento de prueba');
    expect(result.listing?.facts.price_eur_month).toBe(1200);
    expect(result.listing?.spanish_description).toBe('Descripción en español.');
    expect(result.errors).toEqual([]);
  });

  it('classifies blocked, deleted, and incomplete pages', async () => {
    const blocked = parseIdealistaDetail({ html: await fixture('blocked.html'), url: detailUrl });
    expect(blocked.listing?.listing_state).toBe('blocked');
    expect(blocked.completeness?.accepted).toBe(false);

    const deleted = parseIdealistaDetail({ html: await fixture('deleted.html'), url: detailUrl });
    expect(deleted.listing?.listing_state).toBe('deleted');
    expect(deleted.completeness?.rejection_reasons).toContain('listing_deleted');

    const partial = parseIdealistaDetail({ html: await fixture('partial-detail.html'), url: detailUrl });
    expect(partial.listing?.listing_state).toBe('partial');
    expect(partial.completeness?.accepted).toBe(false);
    expect(partial.completeness?.rejection_reasons).toContain('price_not_found');
  });

  it('rejects a document that clearly identifies another listing', () => {
    const result = parseIdealistaDetail({
      url: 'https://www.idealista.com/inmueble/123/',
      html: '<link rel="canonical" href="https://www.idealista.com/inmueble/456/"><h1>Other listing</h1>',
    });
    expect(result.listing?.idealista_id).toBe('456');
    expect(result.completeness?.expected_id_found).toBe(false);
    expect(result.completeness?.rejection_reasons).toContain('document_id_mismatch');
    expect(result.completeness?.accepted).toBe(false);
  });

  it('deduplicates repeated evidence snippets', () => {
    const result = parseIdealistaDetail({
      url: detailUrl,
      html: `<section><h2>Precio</h2><ul><li>Fianza de 1 mes</li></ul><p>Fianza de 1 mes</p></section>`,
    });
    expect(result.listing?.text_evidence.deposit_guarantees).toEqual(['Fianza de 1 mes']);
  });

  it('keeps missing optional fields as null or empty values', () => {
    const result = parseIdealistaDetail({ html: '<h1>Minimal</h1>', url: detailUrl });
    expect(result.listing?.facts.bathrooms).toBeNull();
    expect(result.listing?.property_feature_groups).toEqual({});
    expect(result.listing?.occupancy_profile).toEqual([]);
    expect(result.listing?.price_terms).toBeNull();
  });
});
