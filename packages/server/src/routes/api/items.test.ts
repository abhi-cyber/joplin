import { beforeAllDb, afterAllTests, beforeEachDb, createUserAndSession, models, createItem, makeTempFileWithContent, makeNoteSerializedBody, createItemTree } from '../../utils/testing/testUtils';
import { NoteEntity } from '@joplin/lib/services/database/types';
import { ModelType } from '@joplin/lib/BaseModel';
import { deleteApi, getApi, putApi } from '../../utils/testing/apiUtils';
import { Item } from '../../db';
import { PaginatedItems } from '../../models/ItemModel';

describe('api_items', function() {

	beforeAll(async () => {
		await beforeAllDb('api_items');
	});

	afterAll(async () => {
		await afterAllTests();
	});

	beforeEach(async () => {
		await beforeEachDb();
	});

	test('should create an item', async function() {
		const { user, session } = await createUserAndSession(1, true);

		const noteId = '00000000000000000000000000000001';
		const folderId = '000000000000000000000000000000F1';
		const noteTitle = 'Title';
		const noteBody = 'Body';
		const filename = `${noteId}.md`;
		let item = await createItem(session.id, `root:/${filename}:`, makeNoteSerializedBody({
			id: noteId,
			title: noteTitle,
			body: noteBody,
		}));

		item = await models().item({ userId: user.id }).loadByName(user.id, filename);
		const itemId = item.id;

		expect(!!item.id).toBe(true);
		expect(item.name).toBe(filename);
		expect(item.mime_type).toBe('text/markdown');
		expect(item.jop_id).toBe(noteId);
		expect(item.jop_parent_id).toBe(folderId);
		expect(item.jop_encryption_applied).toBe(0);
		expect(item.jop_type).toBe(ModelType.Note);
		expect(!item.content).toBe(true);
		expect(item.content_size).toBeGreaterThan(0);

		{
			const item: NoteEntity = await models().item({ userId: user.id }).loadAsJoplinItem(itemId);
			expect(item.title).toBe(noteTitle);
			expect(item.body).toBe(noteBody);
		}
	});

	test('should modify an item', async function() {
		const { user, session } = await createUserAndSession(1, true);

		const noteId = '00000000000000000000000000000001';
		const filename = `${noteId}.md`;
		const item = await createItem(session.id, `root:/${filename}:`, makeNoteSerializedBody({
			id: noteId,
		}));

		const newParentId = '000000000000000000000000000000F2';
		const tempFilePath = await makeTempFileWithContent(makeNoteSerializedBody({
			parent_id: newParentId,
			title: 'new title',
		}));

		await putApi(session.id, `items/root:/${filename}:/content`, null, { filePath: tempFilePath });

		const note: NoteEntity = await models().item({ userId: user.id }).loadAsJoplinItem(item.id);
		expect(note.parent_id).toBe(newParentId);
		expect(note.title).toBe('new title');
	});

	test('should delete an item', async function() {
		const { user, session } = await createUserAndSession(1, true);

		const tree: any = {
			'000000000000000000000000000000F1': {
				'00000000000000000000000000000001': null,
			},
		};

		const itemModel = models().item({ userId: user.id });

		await createItemTree(user.id, '', tree);

		await deleteApi(session.id, 'items/root:/00000000000000000000000000000001.md:');

		expect((await itemModel.all()).length).toBe(1);
		expect((await itemModel.all())[0].jop_id).toBe('000000000000000000000000000000F1');
	});

	test('should delete all items', async function() {
		const { user: user1, session: session1 } = await createUserAndSession(1, true);
		const { user: user2 } = await createUserAndSession(2, true);

		await createItemTree(user1.id, '', {
			'000000000000000000000000000000F1': {
				'00000000000000000000000000000001': null,
			},
		});

		const itemModel2 = models().item({ userId: user2.id });

		await createItemTree(user2.id, '', {
			'000000000000000000000000000000F2': {
				'00000000000000000000000000000002': null,
			},
		});

		await deleteApi(session1.id, 'items/root');

		const allItems = await itemModel2.all();
		expect(allItems.length).toBe(2);
		const ids = allItems.map(i => i.jop_id);
		expect(ids.sort()).toEqual(['000000000000000000000000000000F2', '00000000000000000000000000000002'].sort());
	});

	test('should get back the serialized note', async function() {
		const { session } = await createUserAndSession(1, true);

		const noteId = '00000000000000000000000000000001';
		const filename = `${noteId}.md`;
		const serializedNote = makeNoteSerializedBody({
			id: noteId,
		});
		await createItem(session.id, `root:/${filename}:`, serializedNote);

		const result = await getApi(session.id, `items/root:/${filename}:/content`);
		expect(result).toBe(serializedNote);
	});

	test('should get back the item metadata', async function() {
		const { session } = await createUserAndSession(1, true);

		const noteId = '00000000000000000000000000000001';
		await createItem(session.id, `root:/${noteId}.md:`, makeNoteSerializedBody({
			id: noteId,
		}));

		const result: Item = await getApi(session.id, `items/root:/${noteId}.md:`);
		expect(result.name).toBe(`${noteId}.md`);
	});

	test('should list children', async function() {
		const { session } = await createUserAndSession(1, true);

		const itemNames = [
			'.resource/r1',
			'locks/1.json',
			'locks/2.json',
		];

		for (const itemName of itemNames) {
			await createItem(session.id, `root:/${itemName}:`, `Content for :${itemName}`);
		}

		const noteIds: string[] = [];

		for (let i = 1; i <= 3; i++) {
			const noteId = `0000000000000000000000000000000${i}`;
			noteIds.push(noteId);
			await createItem(session.id, `root:/${noteId}.md:`, makeNoteSerializedBody({
				id: noteId,
			}));
		}

		// Get all children

		{
			const result1: PaginatedItems = await getApi(session.id, 'items/root:/:/children', { query: { limit: 4 } });
			expect(result1.items.length).toBe(4);
			expect(result1.has_more).toBe(true);

			const result2: PaginatedItems = await getApi(session.id, 'items/root:/:/children', { query: { cursor: result1.cursor } });
			expect(result2.items.length).toBe(2);
			expect(result2.has_more).toBe(false);

			const items = result1.items.concat(result2.items);

			for (const itemName of itemNames) {
				expect(!!items.find(it => it.name === itemName)).toBe(true);
			}

			for (const noteId of noteIds) {
				expect(!!items.find(it => it.name === `${noteId}.md`)).toBe(true);
			}
		}

		// Get sub-children

		{
			const result: PaginatedItems = await getApi(session.id, 'items/root:/locks/*:/children');
			expect(result.items.length).toBe(2);
			expect(!!result.items.find(it => it.name === 'locks/1.json')).toBe(true);
			expect(!!result.items.find(it => it.name === 'locks/2.json')).toBe(true);
		}
	});

});