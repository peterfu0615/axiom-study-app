import type { ErrorObject } from 'ajv'

declare function validate(data: unknown): boolean

declare namespace validate {
  let errors: ErrorObject[] | null
}

export default validate
