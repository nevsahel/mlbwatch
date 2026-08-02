const { escapeHTML } = require('./core');

describe('escapeHTML', () => {
  it('should return an empty string when passed undefined', () => {
    expect(escapeHTML(undefined)).toBe('');
  });

  it('should return an empty string when passed null', () => {
    expect(escapeHTML(null)).toBe('');
  });

  it('should return an empty string when passed an empty string', () => {
    expect(escapeHTML('')).toBe('');
  });

  it('should escape ampersands (&)', () => {
    expect(escapeHTML('Smith & Wesson')).toBe('Smith &amp; Wesson');
  });

  it('should escape less than (<)', () => {
    expect(escapeHTML('5 < 10')).toBe('5 &lt; 10');
    expect(escapeHTML('<script')).toBe('&lt;script');
  });

  it('should escape greater than (>)', () => {
    expect(escapeHTML('10 > 5')).toBe('10 &gt; 5');
    expect(escapeHTML('script>')).toBe('script&gt;');
  });

  it('should escape double quotes (")', () => {
    expect(escapeHTML('He said "hello"')).toBe('He said &quot;hello&quot;');
  });

  it('should escape single quotes (\')', () => {
    expect(escapeHTML("It's a beautiful day")).toBe('It&#39;s a beautiful day');
  });

  it('should escape multiple special characters in a string', () => {
    const input = '<div class="test" data-id=\'123\'>Me & You</div>';
    const expected = '&lt;div class=&quot;test&quot; data-id=&#39;123&#39;&gt;Me &amp; You&lt;/div&gt;';
    expect(escapeHTML(input)).toBe(expected);
  });

  it('should stringify non-string inputs (like numbers)', () => {
    expect(escapeHTML(123)).toBe('123');
    expect(escapeHTML(0)).toBe('0');
  });

  it('should stringify boolean inputs', () => {
    expect(escapeHTML(true)).toBe('true');
    expect(escapeHTML(false)).toBe('false');
  });

  it('should stringify objects safely', () => {
    // String({}) results in '[object Object]'
    expect(escapeHTML({})).toBe('[object Object]');

    // Arrays join with commas
    expect(escapeHTML([1, 2, 3])).toBe('1,2,3');
  });
});
