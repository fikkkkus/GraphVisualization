import * as THREE from "../static/node_modules/three/build/three.module.js";
import { OrbitControls } from "../static/node_modules/three/examples/jsm/controls/OrbitControls.js";

let scene, camera, renderer, controls, raycaster, mouse, nodeObjectsNew = {}, edgesNew = [], lastClickedNode = null;
let lastRequest = null, lastResultRequest = null;

function init() {
  scene = new THREE.Scene();

  // Настройка камеры
  camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 50);

  renderer = new THREE.WebGLRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('3d-container').appendChild(renderer.domElement);

  // Освещение
  const light = new THREE.AmbientLight(0x404040);
  scene.add(light);

  // Управление камерой
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.25;
  controls.maxPolarAngle = Math.PI;
  controls.minDistance = 0;
  controls.maxDistance = 100;

  // Инициализация Raycaster и мыши
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Слушатель кликов
  window.addEventListener('click', onMouseClick, false);

  animate();
}

// Анимация сцены
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// Загрузка графа с сервера
async function loadGraphData() {
  lastRequest = '/nodes';
  const response = await fetch(lastRequest);
  return await response.json();
}

// Создание узла
function createNode(node, index, totalNodes) {
  const radius = 30; // Радиус распределения узлов

  // Используем Фибоначчиеву спираль для равномерного распределения
  const phi = Math.acos(1 - 2 * (index + 0.5) / totalNodes); // Угол наклона (theta)
  const theta = Math.PI * (1 + Math.sqrt(5)) * index; // Угол азимута (phi)

  // Преобразуем в 3D координаты
  const x = radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.sin(phi) * Math.sin(theta);
  const z = radius * Math.cos(phi);

  // Определение цвета в зависимости от меток узла
  let color = 0x00ff00; // Цвет по умолчанию
  if (node.labels) {
    if (node.labels.includes('Group')) {
      color = 0xFFA500; // Оранжевый для узлов типа "Group"
    } else if (node.labels.includes('User')) {
      color = 0xD8B5FF; // Нежно-фиолетовый для узлов типа "User"
    }
  }

  // Создание сферы для узла
  const geometry = new THREE.SphereGeometry(1, 32, 32);
  const material = new THREE.MeshBasicMaterial({ color: color });
  const sphere = new THREE.Mesh(geometry, material);

  sphere.position.set(x, y, z);
  sphere.userData = node; // Все данные узла сохраняются в userData
  scene.add(sphere);

  nodeObjectsNew[node.id] = sphere;

  sphere.onClick = () => {
    handleNodeClick(sphere);
  };
}

// Создание рёбер
function createEdge(startNode, endNode, direction) {
  const material = new THREE.LineBasicMaterial({ color: 0xffffff });
  const geometry = new THREE.BufferGeometry().setFromPoints([startNode.position, endNode.position]);

  const line = new THREE.Line(geometry, material);
  scene.add(line);

  edgesNew.push({ startNode, endNode, line, direction });
}

// Подсветка рёбер
function highlightEdges(selectedNode) {
  edgesNew.forEach(edge => {
    edge.line.material.color.set(0xffffff);
  edge.line.material.linewidth = 1;
  }); // Сброс подсветки

  edgesNew.forEach(edge => {
  if (edge.startNode === selectedNode || edge.endNode === selectedNode) {
    const isStartNode = edge.startNode === selectedNode;
    const isInDirection = edge.direction === 'in';

    const color = (isStartNode === isInDirection) ? 0x00ff00 : 0x0000ff;
    edge.line.material.color.set(color);

    // Устанавливаем ширину линии
    edge.line.material.linewidth = 10;
  }
});

}

// Обработка клика по узлу
function handleNodeClick(selectedNode) {
  if (lastClickedNode) clearAttributes(lastClickedNode);
  showAttributes(selectedNode.userData);
  highlightEdges(selectedNode);

  lastClickedNode = selectedNode;
}

// Клик мышью
function onMouseClick(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  const intersects = getIntersectedObjects();
  if (intersects.length > 0) {
    const selectedNode = intersects[0].object;
    if (selectedNode.onClick) {
      selectedNode.onClick();
    }
  }
}

// Пересекаемые объекты
function getIntersectedObjects() {
  return raycaster.intersectObjects(Object.values(nodeObjectsNew));
}

// Центрирование камеры на узлах
function centerCameraOnNodes(nodes) {
  let centerX = 0, centerY = 0, centerZ = 0;
  nodes.forEach(node => {
    centerX += node.position.x;
    centerY += node.position.y;
    centerZ += node.position.z;
  });

  centerX /= nodes.length;
  centerY /= nodes.length;
  centerZ /= nodes.length;

  camera.position.set(centerX, centerY, 50);
  controls.target.set(centerX, centerY, centerZ);
}

// Обработчик кнопки "View nodes from ID"
document.getElementById('getNodesFromIdBtn').addEventListener('click', () => {
  // Показываем модальное окно для ввода ID узла
  document.getElementById('modalNodeId').style.display = 'block';
});

// Слушатель на кнопку OK в модальном окне
document.getElementById('submitNodeIdBtn').addEventListener('click', async () => {
  const nodeId = document.getElementById('nodeIdInput').value; // Получаем ID узла из поля ввода
  document.getElementById('loadingIndicator').style.display = 'block';

  document.getElementById('modalNodeId').style.display = 'none';
  document.getElementById('nodeIdInput').value = '';

  if (nodeId) {
    try {
      // Пробуем загрузить данные узлов по введенному ID

      let request = `/nodes/${nodeId}`;
      const response = await fetch(request);

      if (!response.ok) {
        throw new Error('Ошибка сервера при получении узлов');
      }

      const data = await response.json();

      if (data.error) {
        alert(`Не удалось получить узлы по ID: ${nodeId}`);
      } else {

        lastRequest = request
        if (JSON.stringify(lastResultRequest) !== JSON.stringify(data)) {

          lastResultRequest = data

          // Очищаем сцену перед загрузкой новых данных
          scene.clear();
          nodeObjectsNew = {}; // Храним все узлы
          edgesNew = []; // Храним все рёбра

          // Этап 1: Собираем все уникальные узлы в массив
          const nodesArray = [];

          data.forEach((item) => {
            const node = item.node;
            const relatedNode = item.related_node;

            // Добавляем узел в массив, если его там нет
            if (!nodesArray.some(n => n.id === node.id)) {
              nodesArray.push(node);
            }

            // Добавляем связанный узел в массив, если его там нет
            if (!nodesArray.some(n => n.id === relatedNode.id)) {
              nodesArray.push(relatedNode);
            }
          });

          // Этап 2: Создаем все узлы с индексами
          nodesArray.forEach((node, index) => {
            // Создаем узел, если его еще нет
            if (!nodeObjectsNew[node.id]) {
              createNode(node, index, nodesArray.length);  // Передаем общее количество узлов
            }
          });

          // Этап 3: Создаем все рёбра после того, как узлы созданы
          data.forEach((item) => {
            const node = item.node;
            const relatedNode = item.related_node;

            // Получаем ссылки на созданные узлы
            const startNode = nodeObjectsNew[node.id];
            const endNode = nodeObjectsNew[relatedNode.id];

            // Если оба узла существуют, создаем связь
            if (startNode && endNode) {
              const direction = (item.relation_type === 'out') ? 'out' : 'in'; // Направление связи
              createEdge(startNode, endNode, direction); // Создаем связь между узлами
            }
          });

          // Центрируем камеру на всех узлах
          centerCameraOnNodes(Object.values(nodeObjectsNew));
        }
      }
    } catch (error) {
      // Если произошла ошибка при запросе, выводим сообщение
      alert(`Не удалось получить узлы по заданному ID. Ошибка: ${error.message}`);
    }
  }

  document.getElementById('loadingIndicator').style.display = 'none';
});

// Слушатель на кнопку Cancel в модальном окне
document.getElementById('cancelNodeIdBtn').addEventListener('click', () => {
  // Закрываем модальное окно, если пользователь отменил действие
  document.getElementById('modalNodeId').style.display = 'none';
  document.getElementById('nodeIdInput').value = '';
});


// Загрузка всех узлов
document.getElementById('loadNodesBtn').addEventListener('click', async () => {
  document.getElementById('loadingIndicator').style.display = 'block';

  const data = await loadGraphData();

  if (JSON.stringify(lastResultRequest) !== JSON.stringify(data)) {
    lastResultRequest = data

    // Очищаем сцену перед загрузкой новых данных
    scene.clear();
    nodeObjectsNew = {}; // Храним все узлы
    edgesNew = []; // Храним все рёбра

    // Этап 1: Собираем все уникальные узлы в массив
    const nodesArray = [];

    data.forEach((item) => {
      const node = item.node;
      const relatedNode = item.related_node;

      // Добавляем узел в массив, если его там нет
      if (!nodesArray.some(n => n.id === node.id)) {
        nodesArray.push(node);
      }

      // Добавляем связанный узел в массив, если его там нет
      if (!nodesArray.some(n => n.id === relatedNode.id)) {
        nodesArray.push(relatedNode);
      }
    });

    // Этап 2: Создаем все узлы с индексами
    nodesArray.forEach((node, index) => {
      // Создаем узел, если его еще нет
      if (!nodeObjectsNew[node.id]) {
        createNode(node, index, nodesArray.length);  // Передаем общее количество узлов
      }
    });

    // Этап 3: Создаем все рёбра после того, как узлы созданы
    data.forEach((item) => {
      const node = item.node;
      const relatedNode = item.related_node;

      // Получаем ссылки на созданные узлы
      const startNode = nodeObjectsNew[node.id];
      const endNode = nodeObjectsNew[relatedNode.id];

      // Если оба узла существуют, создаем связь
      if (startNode && endNode) {
        const direction = (item.relation_type === 'out') ? 'out' : 'in'; // Направление связи
        createEdge(startNode, endNode, direction); // Создаем связь между узлами
      }
    });

    // Центрируем камеру на всех узлах
    centerCameraOnNodes(Object.values(nodeObjectsNew));

  }
  document.getElementById('loadingIndicator').style.display = 'none';
});

// Отображение атрибутов узла
function showAttributes(nodeData) {
  const attributeDiv = document.getElementById('nodeAttributes');

  // Определяем цвет фона в зависимости от типа узла
  if (nodeData.labels && nodeData.labels.includes('Group')) {
    attributeDiv.style.backgroundColor = '#FFA500'; // Оранжевый для Group
    attributeDiv.style.color = '#000000'; // Черный текст
  } else if (nodeData.labels && nodeData.labels.includes('User')) {
    attributeDiv.style.backgroundColor = '#D8B5FF'; // Фиолетовый для User
    attributeDiv.style.color = '#000000'; // Черный текст
  } else {
    attributeDiv.style.backgroundColor = '#FFFFFF'; // Белый по умолчанию
    attributeDiv.style.color = '#000000'; // Черный текст
  }

  // Очистить содержимое перед добавлением
  attributeDiv.innerHTML = '';

  // Заголовок
  const header = document.createElement('h3');
  header.textContent = 'Атрибуты выбранного элемента';
  header.style.marginBottom = '10px';
  header.style.fontWeight = 'bold';
  attributeDiv.appendChild(header);

  // Отображаем ID
  const idParagraph = document.createElement('p');
  idParagraph.textContent = `ID: ${nodeData.id}`; // Используем обратные кавычки
  idParagraph.style.fontWeight = 'bold';
  attributeDiv.appendChild(idParagraph);

  // Отображаем остальные атрибуты, исключая labels
  for (const [key, value] of Object.entries(nodeData)) {
    if (key === 'labels' || key == 'id') continue; // Пропускаем labels
    const paragraph = document.createElement('p');
    paragraph.textContent = `${key}: ${JSON.stringify(value)}`; // Используем обратные кавычки
    paragraph.style.fontWeight = 'bold'; // Жирный шрифт
    attributeDiv.appendChild(paragraph);
}

}

// Скрыть модальное окно при клике на кнопку Cancel
document.getElementById('cancelDeleteNodesBtn').addEventListener('click', function() {
      document.getElementById('deleteNodesModal').style.display = 'none';

      const nodeIdsInputs = document.querySelectorAll('.nodeIdsInput');
  nodeIdsInputs.forEach(input => {
    input.value = ''; // Очищаем каждое поле
  });

  // Дополнительно можно удалить все элементы списка (если они есть)
  const nodeIdsContainer = document.getElementById('nodeIdsContainer');
  while (nodeIdsContainer.children.length > 1) {
    nodeIdsContainer.removeChild(nodeIdsContainer.lastChild);
  }

});

    // Показать модальное окно при клике на кнопку "Delete nodes"
document.getElementById('deleteNodesBtn').addEventListener('click', function() {
      document.getElementById('deleteNodesModal').style.display = 'block';
    });

    // Добавить новый input для узла
document.getElementById('addNodeBtn').addEventListener('click', function() {
  const nodeIdsContainer = document.getElementById('nodeIdsContainer');

  // Создаем новый элемент списка (li)
  const newListItem = document.createElement('li');

  // Создаем новый input
  const newInput = document.createElement('input');
  newInput.type = 'text';
  newInput.classList.add('nodeIdsInput');
  newInput.placeholder = 'id node';  // Подсказка для пользователя

  // Создаем кнопку для удаления
  const removeButton = document.createElement('button');
  removeButton.classList.add('removeConnectionBtn');
  removeButton.textContent = 'Remove';

  // Добавляем обработчик события на кнопку удаления
  removeButton.addEventListener('click', function() {
    // Удаляем родительский элемент li (который включает и input, и кнопку)
    nodeIdsContainer.removeChild(newListItem);
  });

  // Добавляем input и кнопку в новый элемент списка
  newListItem.appendChild(newInput);
  newListItem.appendChild(removeButton);

  // Добавляем новый элемент списка в контейнер
  nodeIdsContainer.appendChild(newListItem);
});


    // Подтвердить удаление узлов
document.getElementById('confirmDeleteNodesBtn').addEventListener('click', function() {
  const nodeIds = [];

  // Получаем все значения из полей ввода с классом 'nodeIdsInput'
  const nodeIdsInputs = document.querySelectorAll('.nodeIdsInput');

  nodeIdsInputs.forEach(input => {
    const nodeId = input.value.trim();
    if (nodeId) {
      nodeIds.push(nodeId); // Добавляем ID в массив, если оно не пустое
    }
  });

  // Если нет ID для удаления, выводим сообщение
  if (nodeIds.length === 0) {
    alert('Please enter at least one Node ID to delete!');
    return;
  }

  nodeIdsInputs.forEach(input => {
    input.value = ''; // Очищаем каждое поле
  });

  // Дополнительно можно удалить все элементы списка (если они есть)
  const nodeIdsContainer = document.getElementById('nodeIdsContainer');
  while (nodeIdsContainer.children.length > 1) {
    nodeIdsContainer.removeChild(nodeIdsContainer.lastChild);
  }

  // Логируем данные, которые отправляются на сервер
  console.log('Nodes to be deleted:', nodeIds);

  // Закрытие модального окна
  document.getElementById('deleteNodesModal').style.display = 'none';

  // Формируем запрос на удаление через fetch
  fetch("http://127.0.0.1:8000/delete/nodes/", {
    method: "DELETE",
    headers: {
      "Authorization": "Bearer token",  // Замените на ваш реальный токен
      "Content-Type": "application/json"
    },
    body: JSON.stringify(nodeIds) // Отправляем массив ID узлов
  })
  .then(response => {
    if (!response.ok) {
      // Если ответ не успешен (например, ошибка сервера)
      return response.json().then(data => {
        throw new Error(data.error || 'Unknown error');
      });
    }
    return response.json();
  })
  .then(data => {
    if (data.details && data.details.length > 0) {
      let success = true;
      let errorMessage = '';

      // Перебираем детали, чтобы вывести успешные и неуспешные сообщения
      data.details.forEach(item => {
        if (item.status === 'failed') {
          success = false;
          errorMessage += `Error deleting node ${item.node_id}: ${item.message}\n`;
        }
      });

      // Если были ошибки при удалении
      if (!success) {
        alert('Some nodes failed to delete:\n' + errorMessage);
        executePostSuccessActions(lastRequest);
      } else {
        alert('Nodes successfully deleted!');
        executePostSuccessActions(lastRequest);
      }

      console.log('Response from server:', data);
    } else {
      executePostSuccessActions(lastRequest);
      alert('Unexpected server response!');
    }
  })
  .catch(error => {
    executePostSuccessActions(lastRequest);
    alert('Network error: ' + error.message);  // Ошибка сети
    console.error('Error:', error);
  });

});


document.getElementById('deleteNodesModal').style.display = 'none';

// Показать модальное окно создания узлов
document.getElementById('createNodesBtn').addEventListener('click', function() {
  document.getElementById('createNodesModal').style.display = 'block';
});

// Скрыть модальное окно
document.getElementById('cancelCreateNodesBtn').addEventListener('click', function() {
  document.getElementById('createNodesModal').style.display = 'none';

    const nodeIdInputs = document.querySelectorAll('.nodeIdInput');
  nodeIdInputs.forEach(input => {
    input.value = ''; // Очищаем поля ввода
  });

      // Получаем контейнер с элементами
    const connectionList = document.getElementById('connectionList');

    // Удаляем все элементы, кроме первого
    while (connectionList.children.length > 1) {
      connectionList.removeChild(connectionList.lastChild); // Удаляем последний дочерний элемент
    }

});

// Добавить новую связь в список
document.getElementById('addConnectionBtn').addEventListener('click', function() {
  const connectionList = document.getElementById('connectionList');

  // Создаём новый элемент для связи
  const listItem = document.createElement('li');
  listItem.classList.add('connectionItem');
  listItem.innerHTML = `
    <input type="text" class="nodeIdInput" placeholder="ID 1" />
    <select class="relationTypeSelect">
      <option value="follow">Follow</option>
      <option value="subscribe">Subscribe</option>
    </select>
    <input type="text" class="nodeIdInput" placeholder="ID 2" />
    <button class="removeConnectionBtn">Remove</button>
  `;

  // Добавляем обработчик для кнопки удаления
  listItem.querySelector('.removeConnectionBtn').addEventListener('click', function() {
    listItem.remove();
  });

  // Добавляем элемент в список
  connectionList.appendChild(listItem);
});

// Добавить нового пользователя
document.getElementById('addUserBtn').addEventListener('click', function() {
  const connectionList = document.getElementById('connectionList');

  // Создаём новый элемент для пользователя
  const listItem = document.createElement('li');
  listItem.classList.add('nodeItem');
  listItem.innerHTML = `
    <input type="text" class="nodeIdInput" placeholder="User ID" />
    <button class="removeConnectionBtn">Remove</button>
  `;

  // Добавляем обработчик для кнопки удаления
  listItem.querySelector('.removeConnectionBtn').addEventListener('click', function() {
    listItem.remove();
  });

  // Добавляем элемент в список
  connectionList.appendChild(listItem);
});

// Добавить новую группу
document.getElementById('addGroupBtn').addEventListener('click', function () {
  const connectionList = document.getElementById('connectionList');

  // Создаём новый элемент для группы
  const listItem = document.createElement('li');
  listItem.classList.add('nodeItem');
  listItem.innerHTML = `
    <input type="text" class="nodeIdInput" data-prefix="group_" placeholder="Group ID" />
    <button class="removeConnectionBtn">Remove</button>
  `;

  // Добавляем обработчик для кнопки удаления
  listItem.querySelector('.removeConnectionBtn').addEventListener('click', function () {
    listItem.remove();
  });

  // Добавляем элемент в список
  connectionList.appendChild(listItem);
});

document.getElementById('confirmCreateNodesBtn').addEventListener('click', function() {
  const connections = [];
  const users = []; // Для пользователей (nodes)
  const groups = []; // Для групп
  const listItems = document.querySelectorAll('#connectionList li');
  let hasError = false;

  document.getElementById('createNodesModal').style.display = 'none';

  // Перебираем элементы списка
  listItems.forEach(item => {
    const inputs = item.querySelectorAll('.nodeIdInput');
    const select = item.querySelector('.relationTypeSelect');

    // Если есть селект, то это связь
    if (select) {
      const node1 = inputs[0].value.trim();
      const relation = select.value;
      const node2 = inputs[1].value.trim();

      // Проверка на пустые поля
      if (!node1 || !node2) {
        alert('Both node IDs must be filled for connections!');
        hasError = true;
        return; // Прерываем выполнение, если есть ошибка
      }

      connections.push({ start_id: node1, end_id: node2, type: relation });
    } else { // Если нет селекта, то это обычный узел
      const nodeId = inputs[0].value.trim();
      const pref = inputs[0].getAttribute('data-prefix');
      // Проверка на пустое поле для узла
      if (!nodeId) {
        alert('Node ID cannot be empty!');
        hasError = true;
        return; // Прерываем выполнение, если есть ошибка
      }
      console.log(pref)
      // Учитываем, если nodeId - это группа или пользователь (например, можно делить по ID)
      if (pref != null) { // Пример: если ID начинается с "group_", это группа
        groups.push({ id: nodeId });
      } else {
        users.push({ id: nodeId });
      }
    }
  });

  // Если есть ошибка, не отправляем запрос
  if (hasError) {
    return;
  }

  // Создаём JSON объект с пользователями, группами и связями
  const dataToSend = {
    users: users,      // Пользователи
    groups: groups,    // Группы
    relations: connections // Связи
  };

   const nodeIdInputs = document.querySelectorAll('.nodeIdInput');
  nodeIdInputs.forEach(input => {
    input.value = ''; // Очищаем поля ввода
  });

  // Получаем контейнер с элементами
  const connectionList = document.getElementById('connectionList');

  // Удаляем все элементы, кроме первого
  while (connectionList.children.length > 1) {
    connectionList.removeChild(connectionList.lastChild); // Удаляем последний дочерний элемент
  }

  // Логируем данные, которые отправляются на сервер
  console.log('Data being sent to the server:', JSON.stringify(dataToSend));

  // Формируем cURL запрос (здесь отправка через fetch)
  fetch("http://127.0.0.1:8000/add/nodes/", {
    method: "POST",
    headers: {
      "Authorization": "Bearer token",   // Замените на ваш реальный токен
      "Content-Type": "application/json"
    },
    body: JSON.stringify(dataToSend) // Отправляем данные в формате JSON
  })
  .then(response => response.json())
  .then(data => {
    // Если сервер возвращает ошибки
    if (data.details && data.details.errors && data.details.errors.length > 0) {
      let errorMessage = 'The following errors occurred:\n';
      data.details.errors.forEach((error, index) => {
        errorMessage += `${index + 1}. ${error}\n`; // Добавляем каждую ошибку в сообщение
      });
      alert(errorMessage); // Выводим все ошибки
       executePostSuccessActions(lastRequest);
      return;
    }

    // Если нет ошибок, и запрос был успешным
    if (data.message && data.message === 'Segment added successfully') {
      alert('Nodes, groups, and relations were successfully added!');

      // Скрыть модальное окно после успешного создания
      console.log('Response from server:', data);
    }
     executePostSuccessActions(lastRequest);
  })
  .catch(error => {
    // Если произошла ошибка при отправке запроса
    alert('Network error: ' + error.message);
    console.error('Error:', error);
     executePostSuccessActions(lastRequest);
  });

});


function executePostSuccessActions(url) {
   if (lastRequest !== null) {

     // Проверяем, является ли URL запросом всех узлов или конкретного узла
     if (url === '/nodes') {
       document.getElementById('loadNodesBtn').click(); // Триггерим загрузку всех узлов
     } else if (url.startsWith('/nodes/')) {
       const nodeId = url.split('/').pop(); // Извлекаем node_id из URL
       document.getElementById('nodeIdInput').value = nodeId;
       console.log("6883954741")
       // Устанавливаем node_id в поле ввода
       document.getElementById('submitNodeIdBtn').click(); // Триггерим загрузку узла по ID
     }
   }
}

// Очистка атрибутов
function clearAttributes(node) {
  const attributeDiv = document.getElementById('nodeAttributes');
  attributeDiv.innerHTML = '';
}

document.querySelectorAll('.removeConnectionBtn').forEach(button => {
  button.addEventListener('click', function () {
    const listItem = this.closest('li'); // Найти ближайший элемент списка
    listItem.remove(); // Удалить элемент списка
  });
});


init();