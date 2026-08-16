/**
 * Global vitest setup — runs once per worker before any test.
 *
 * Notes on why each import lives here:
 *  - @testing-library/jest-dom augments `expect` with DOM matchers
 *    (toBeInTheDocument, toHaveTextContent, toBeVisible, …). These
 *    are a no-op under the default `environment: 'node'`, and they
 *    activate transparently for files that opt in via the
 *    `// @vitest-environment jsdom` directive.
 *  - The afterEach cleanup call ensures RTL unmounts every rendered
 *    tree between tests so DOM state never leaks. This is critical
 *    for enterprise-grade test hygiene — a leaked component from a
 *    prior test masking a failure in a later one is exactly the
 *    kind of intermittent that erodes trust in the suite.
 */

import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
