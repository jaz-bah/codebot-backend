import Joi from 'joi';

/**
 * PATCH /todos/reorder body — a sparse, explicit assignment map:
 * `{ items: [{ id, position }] }`. The service validates ids + positions and
 * applies them inside ONE database transaction (gap-free compaction of the
 * unmentioned todos). Partial subsets are supported for drag-and-drop within
 * a filtered list.
 */
export interface ReorderItemDto {
  id: string;
  position: number;
}

export interface ReorderTodosDto {
  items: ReorderItemDto[];
}

export const reorderTodosSchema = Joi.object({
  items: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().uuid().required(),
        position: Joi.number().integer().min(0).required(),
      }),
    )
    .min(1)
    .max(1000)
    .required(),
});
