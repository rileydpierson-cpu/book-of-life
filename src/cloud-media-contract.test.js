import { describe, expect, it } from 'vitest';
import { toMedia } from '../apps/web/lib/supabase-api.js';

describe('cloud media contract', () => {
  it('serializes canonical media with registered device locations', () => {
    const media = toMedia({
      id: 'canonical-1',
      library_id: 'library-1',
      content_hash: 'abc123',
      file_name: 'photo.jpg',
      has_thumb: true,
      media_locations: [{
        id: 'location-1',
        device_id: 'desktop-1',
        local_media_id: 'local-photo',
        file_name: 'photo.jpg',
        storage_root_label: 'Pictures',
        relative_path: 'Trips/photo.jpg',
        availability: 'available',
        devices: { device_name: 'Rilo Desktop', device_type: 'desktop' }
      }]
    });

    expect(media.contentHash).toBe('abc123');
    expect(media.locations[0]).toMatchObject({
      deviceName: 'Rilo Desktop',
      storageRootLabel: 'Pictures',
      relativePath: 'Trips/photo.jpg'
    });
    expect(media.availability).toMatchObject({ localCopies: 1, hasThumb: true });
  });
});
