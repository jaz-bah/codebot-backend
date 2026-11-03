import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedGuard } from '../../common/guards/authenticated.guard';
import { JoiValidationPipe } from '../../common/pipes/joi-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Todo } from '../../database/typeorm/entities/todo.entity';
import { createTodoSchema, CreateTodoDto } from './dto/create-todo.dto';
import { queryTodosSchema, QueryTodosDto } from './dto/query-todos.dto';
import { reorderTodosSchema, ReorderTodosDto } from './dto/reorder-todos.dto';
import { updateTodoSchema, UpdateTodoDto } from './dto/update-todo.dto';
import { TodosService, TodoPage, ReorderResult } from './todos.service';

/**
 * User-owned todo surface. Routes WITHOUT a param (reorder) are declared
 * before the `:id` routes so Nest matches them first.
 */
@Controller('todos')
@UseGuards(AuthenticatedGuard)
export class TodosController {
  constructor(private readonly todos: TodosService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JoiValidationPipe(createTodoSchema)) dto: CreateTodoDto,
  ): Promise<Todo> {
    return this.todos.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new JoiValidationPipe(queryTodosSchema)) query: QueryTodosDto,
  ): Promise<TodoPage> {
    return this.todos.list(user.id, query ?? ({} as QueryTodosDto));
  }

  @Patch('reorder')
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JoiValidationPipe(reorderTodosSchema)) dto: ReorderTodosDto,
  ): Promise<ReorderResult> {
    return this.todos.reorder(user.id, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Todo> {
    return this.todos.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new JoiValidationPipe(updateTodoSchema)) dto: UpdateTodoDto,
  ): Promise<Todo> {
    return this.todos.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean; id: string }> {
    return this.todos.remove(user.id, id);
  }
}
