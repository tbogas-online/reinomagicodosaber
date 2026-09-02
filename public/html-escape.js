/**
 * Escape HTML para uso seguro em innerHTML (texto e atributos com aspas duplas).
 */
(function (global) {
  'use strict';

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  global.ReinoHtmlEscape = Object.freeze({ escapeHtml });
})(typeof window !== 'undefined' ? window : globalThis);
