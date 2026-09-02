import { baseEnv } from '@app/shared/src/utils/env'
import { z } from 'zod'

// Переменные, нужные только этому пакету: они не должны валить
// запуск остальных сервисов. Внутри маркеров пишет генератор,
// снаружи — можно дописывать руками.
const extra = z.object({
	// <template:extend>
	SERVER_PORT: z.coerce.number(),
	// </template:extend>
})

export default baseEnv.extend(extra.shape).parse(process.env)
