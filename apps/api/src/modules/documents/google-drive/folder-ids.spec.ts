import { parseFolderIds } from './google-drive.controller';

describe('parseFolderIds', () => {
  it('saca el id de links de carpeta, de ?id= y de ids sueltos', () => {
    expect(
      parseFolderIds(
        'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing, https://drive.google.com/open?id=1ZzYyXxWwVvUu\n1QqRrSsTtUuVv',
      ),
    ).toEqual(['1AbCdEfGhIjKlMnOp', '1ZzYyXxWwVvUu', '1QqRrSsTtUuVv']);
  });
  it('ignora texto que no es carpeta y repetidos', () => {
    expect(parseFolderIds('hola, https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp')).toEqual(['1AbCdEfGhIjKlMnOp']);
  });
});
