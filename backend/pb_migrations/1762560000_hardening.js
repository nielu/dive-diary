/// <reference path="../pb_data/types.d.ts" />

// Security hardening (review, Nov 2026):
//  - Rate limiting on, with logins limited per visitor address. Railway's edge
//    overwrites X-Real-IP with the real client address, so trust that header;
//    without it every visitor looks like the proxy and shares one limit.
//  - Map and photo files are protected: direct /api/files URLs need a file
//    token (the owner app fetches one). Family viewers get files through
//    /api/share/{token}/file/..., which stops working when the link is off.
migrate(
  (app) => {
    const settings = app.settings();
    unmarshal(
      {
        rateLimits: {
          enabled: true,
          rules: [
            // password logins from visitors who aren't signed in
            { label: "*:auth", audience: "@guest", maxRequests: 5, duration: 60 },
            // owner uploading a trip's worth of photos after being offline
            { label: "*:create", audience: "", maxRequests: 50, duration: 10 },
            { label: "/api/batch", audience: "", maxRequests: 3, duration: 1 },
            { label: "/api/", audience: "", maxRequests: 300, duration: 10 },
          ],
        },
        trustedProxy: { headers: ["X-Real-IP"], useLeftmostIP: false },
      },
      settings,
    );
    app.save(settings);

    for (const name of ["maps", "photos"]) {
      const col = app.findCollectionByNameOrId(name);
      col.fields.getByName("image").protected = true;
      app.save(col);
    }

    // Owner file tokens last two days; the app renews them twice a day.
    const users = app.findCollectionByNameOrId("users");
    users.fileToken.duration = 60 * 60 * 48;
    app.save(users);
  },
  (app) => {
    const settings = app.settings();
    unmarshal({ rateLimits: { enabled: false }, trustedProxy: { headers: [] } }, settings);
    app.save(settings);
    for (const name of ["maps", "photos"]) {
      const col = app.findCollectionByNameOrId(name);
      col.fields.getByName("image").protected = false;
      app.save(col);
    }
    const users = app.findCollectionByNameOrId("users");
    users.fileToken.duration = 180;
    app.save(users);
  },
);
